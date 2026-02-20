import type {
  ModelContextTool,
  RuntimeLogEntry,
  RuntimeMetrics,
  ToolCallRecord,
  ToolClient
} from "../types";
import { coerceArgsToSchema, normalizeTool, normalizeTools, type NormalizedTool } from "./schema";

export interface RuntimeSnapshot {
  tools: Array<Pick<NormalizedTool, "name" | "description" | "inputSchema" | "annotations">>;
  logs: RuntimeLogEntry[];
  metrics: RuntimeMetrics;
  scene: string;
  isNativeSupported: boolean;
  agentRunning: boolean;
}

interface ModelContextBridge {
  _tools: ModelContextTool[];
  provideContext?: (options: { tools: ModelContextTool[] }) => void;
  registerTool?: (tool: ModelContextTool) => void;
  unregisterTool?: (name: string) => void;
  clearContext?: () => void;
}

type SnapshotSubscriber = (snapshot: RuntimeSnapshot) => void;
type ToolCallSubscriber = (record: ToolCallRecord) => void;

const MAX_LOGS = 240;
const TOOL_ALIASES: Record<string, string> = {};

function now() {
  return Date.now();
}

export class WebMcpRuntime {
  private tools: NormalizedTool[] = [];
  private logs: RuntimeLogEntry[] = [];
  private subscribers = new Set<SnapshotSubscriber>();
  private toolCallSubscribers = new Set<ToolCallSubscriber>();
  private queue = Promise.resolve<unknown>(undefined);
  private installed = false;
  private runtimeStartMs: number | null = null;
  private scene = "Idle";

  private metrics: RuntimeMetrics = {
    totalCalls: 0,
    successCalls: 0,
    failedCalls: 0,
    queueDepth: 0,
    runtimeMs: 0
  };

  public install() {
    if (this.installed) {
      return;
    }

    this.installed = true;
    const nativeSupported = "modelContext" in navigator;
    const runtime = this;

    if (!nativeSupported) {
      (navigator as Navigator & { modelContext: ModelContextBridge }).modelContext = {
        _tools: [],
        provideContext(options: { tools: ModelContextTool[] }) {
          const incoming = Array.isArray(options?.tools) ? options.tools : [];
          this._tools = incoming;
          runtime.registerToolsInternal(incoming, { emitLog: false });
        },
        registerTool(tool: ModelContextTool) {
          this._tools = this._tools.filter((candidate) => candidate.name !== tool.name);
          this._tools.push(tool);
          runtime.registerToolInternal(tool, { emitLog: false });
        },
        unregisterTool(name: string) {
          this._tools = this._tools.filter((candidate) => candidate.name !== name);
          runtime.unregisterToolInternal(name, { emitLog: false });
        },
        clearContext() {
          this._tools = [];
          runtime.clearToolsInternal({ emitLog: false });
        }
      };
    }

    this.log(
      nativeSupported ? "WebMCP native interface detected" : "WebMCP native interface missing. Polyfill active",
      nativeSupported ? "success" : "warn"
    );
  }

  public getSnapshot(): RuntimeSnapshot {
    return {
      tools: this.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: tool.annotations
      })),
      logs: this.logs.slice(),
      metrics: {
        totalCalls: this.metrics.totalCalls,
        successCalls: this.metrics.successCalls,
        failedCalls: this.metrics.failedCalls,
        queueDepth: this.metrics.queueDepth,
        runtimeMs: this.metrics.runtimeMs
      },
      scene: this.scene,
      isNativeSupported: "modelContext" in navigator,
      agentRunning: this.runtimeStartMs !== null
    };
  }

  public subscribe(listener: SnapshotSubscriber): () => void {
    this.subscribers.add(listener);
    listener(this.getSnapshot());
    return () => {
      this.subscribers.delete(listener);
    };
  }

  public subscribeToolCalls(listener: ToolCallSubscriber): () => void {
    this.toolCallSubscribers.add(listener);
    return () => {
      this.toolCallSubscribers.delete(listener);
    };
  }

  public setAgentRunning(running: boolean) {
    if (running) {
      this.runtimeStartMs = performance.now();
      this.metrics.totalCalls = 0;
      this.metrics.successCalls = 0;
      this.metrics.failedCalls = 0;
      this.metrics.queueDepth = 0;
      this.metrics.runtimeMs = 0;
      this.log("Agent run started", "info");
    } else {
      this.runtimeStartMs = null;
      this.log("Agent run stopped", "warn");
    }

    this.emitSnapshot();
  }

  public restoreFromShare(metrics: RuntimeMetrics, toolCalls: ToolCallRecord[]) {
    this.metrics = { ...metrics };
    this.logs = toolCalls.map((tc) => ({
      at: tc.at,
      level: (tc.ok ? "success" : "error") as RuntimeLogEntry["level"],
      message: `[replay] ${tc.ok ? "<-" : "!!"} ${tc.name} (${tc.elapsedMs}ms)`,
      payload: tc.ok ? tc.result : tc.error
    })).reverse().slice(0, MAX_LOGS);
    this.scene = "Shared composition";
    this.emitSnapshot();
  }

  public setScene(scene: string) {
    this.scene = scene || "Idle";
    this.emitSnapshot();
  }

  public log(message: string, level: RuntimeLogEntry["level"] = "info", payload?: unknown) {
    this.logs = [
      {
        at: now(),
        level,
        message,
        payload
      },
      ...this.logs
    ].slice(0, MAX_LOGS);

    this.emitSnapshot();
  }

  public registerTools(tools: ModelContextTool[]) {
    this.registerToolsInternal(tools, { emitLog: true });
  }

  public registerTool(tool: ModelContextTool) {
    this.registerToolInternal(tool, { emitLog: true });
  }

  public unregisterTool(name: string) {
    this.unregisterToolInternal(name, { emitLog: true });
  }

  public clearTools() {
    this.clearToolsInternal({ emitLog: true });
  }

  public getTools() {
    return this.tools.slice();
  }

  private normalizeToolName(name: string): string {
    return String(name || "")
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
  }

  private findToolByName(name: string): { tool: NormalizedTool | undefined; requestedName: string } {
    const requestedName = String(name || "").trim();
    if (!requestedName) {
      return { tool: undefined, requestedName };
    }

    const exact = this.tools.find((candidate) => candidate.name === requestedName);
    if (exact) {
      return { tool: exact, requestedName };
    }

    const normalizedRequested = this.normalizeToolName(requestedName);
    const alias = TOOL_ALIASES[normalizedRequested];
    if (alias) {
      const aliasTool = this.tools.find((candidate) => candidate.name === alias);
      if (aliasTool) {
        this.log(`Tool alias mapped: ${requestedName} -> ${aliasTool.name}`, "warn");
        return { tool: aliasTool, requestedName };
      }
    }

    const normalizedMatch = this.tools.find(
      (candidate) => this.normalizeToolName(candidate.name) === normalizedRequested
    );
    return { tool: normalizedMatch, requestedName };
  }

  public async invokeTool(name: string, rawParams: Record<string, unknown>, source = "manual") {
    const { tool, requestedName } = this.findToolByName(name);
    if (!tool) {
      const available = this.tools.map((candidate) => candidate.name).slice(0, 12);
      const message = `Tool not found: ${requestedName}. Available tools: ${available.join(", ")}`;
      this.metrics.totalCalls += 1;
      this.metrics.failedCalls += 1;
      this.updateRuntimeMs();
      this.log(message, "error");
      throw new Error(message);
    }

    const params = coerceArgsToSchema(rawParams ?? {}, tool.inputSchema);

    this.metrics.queueDepth += 1;
    this.updateRuntimeMs();
    this.emitSnapshot();

    const executeTask = async () => {
      this.metrics.queueDepth = Math.max(0, this.metrics.queueDepth - 1);
      this.metrics.totalCalls += 1;
      this.updateRuntimeMs();
      this.emitSnapshot();

      const started = performance.now();
      this.setScene(`Executing ${tool.name}`);
      this.log(`[${source}] -> ${tool.name}`, "info", params);

      const client: ToolClient = {
        requestUserInteraction: async <T>(callback: () => Promise<T> | T) => callback()
      };

      try {
        const result = await Promise.resolve(tool.execute(params, client));
        const elapsedMs = Math.max(0, Math.round(performance.now() - started));

        this.metrics.successCalls += 1;
        this.updateRuntimeMs();
        this.log(`[${source}] <- ${tool.name} ok (${elapsedMs}ms)`, "success");

        const record: ToolCallRecord = {
          name: tool.name,
          args: params,
          source,
          at: now(),
          elapsedMs,
          ok: true,
          result
        };
        this.emitToolCall(record);
        this.emitSnapshot();

        return {
          ok: true,
          data: result,
          error: null
        };
      } catch (error) {
        const elapsedMs = Math.max(0, Math.round(performance.now() - started));
        const message = error instanceof Error ? error.message : String(error);

        this.metrics.failedCalls += 1;
        this.updateRuntimeMs();
        this.log(`[${source}] <- ${tool.name} failed`, "error", message);

        const record: ToolCallRecord = {
          name: tool.name,
          args: params,
          source,
          at: now(),
          elapsedMs,
          ok: false,
          error: message
        };
        this.emitToolCall(record);
        this.emitSnapshot();

        return {
          ok: false,
          data: null,
          error: message
        };
      }
    };

    const queued = this.queue.then(executeTask, executeTask);
    this.queue = queued.catch(() => undefined);
    return queued;
  }

  private registerToolsInternal(tools: ModelContextTool[], options: { emitLog: boolean }) {
    this.tools = normalizeTools(Array.isArray(tools) ? tools : []);
    if (options.emitLog) {
      this.log("Tools registered", "success", { count: this.tools.length });
    }
    this.emitSnapshot();
  }

  private registerToolInternal(tool: ModelContextTool, options: { emitLog: boolean }) {
    const normalized = normalizeTool(tool);
    const current = this.tools.filter((candidate) => candidate.name !== normalized.name);
    this.tools = [...current, normalized].sort((a, b) => a.name.localeCompare(b.name));
    if (options.emitLog) {
      this.log(`Tool registered: ${normalized.name}`, "success");
    }
    this.emitSnapshot();
  }

  private unregisterToolInternal(name: string, options: { emitLog: boolean }) {
    this.tools = this.tools.filter((tool) => tool.name !== name);
    if (options.emitLog) {
      this.log(`Tool unregistered: ${name}`, "warn");
    }
    this.emitSnapshot();
  }

  private clearToolsInternal(options: { emitLog: boolean }) {
    this.tools = [];
    if (options.emitLog) {
      this.log("Tools cleared", "warn");
    }
    this.emitSnapshot();
  }

  private emitToolCall(record: ToolCallRecord) {
    for (const listener of this.toolCallSubscribers) {
      listener(record);
    }
  }

  private emitSnapshot() {
    this.updateRuntimeMs();
    const snapshot = this.getSnapshot();
    for (const listener of this.subscribers) {
      listener(snapshot);
    }
  }

  private updateRuntimeMs() {
    if (this.runtimeStartMs === null) {
      return;
    }
    this.metrics.runtimeMs = Math.max(0, performance.now() - this.runtimeStartMs);
  }
}
