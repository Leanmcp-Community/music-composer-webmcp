import type { AgentRunConfig, ReplayRun, ToolCallRecord } from "../types";
import type { WebMcpRuntime } from "./webmcpRuntime";

function toBase64Url(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  const encoded = btoa(binary);
  return encoded.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value: string): string {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const withPadding = padded.padEnd(Math.ceil(padded.length / 4) * 4, "=");
  const binary = atob(withPadding);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

export class ReplayEngine {
  private run: ReplayRun | null = null;

  start(config: AgentRunConfig): ReplayRun {
    this.run = {
      version: 1,
      objective: config.objective,
      model: config.model,
      endpoint: `gateway/${config.provider}`,
      seed: Math.floor(Math.random() * 1_000_000_000),
      startedAt: new Date().toISOString(),
      toolCalls: []
    };

    return this.run;
  }

  recordToolCall(record: ToolCallRecord) {
    if (!this.run) {
      return;
    }

    this.run.toolCalls.push(record);
  }

  finish(): ReplayRun | null {
    if (!this.run) {
      return null;
    }

    this.run.completedAt = new Date().toISOString();
    return this.run;
  }

  getCurrent() {
    return this.run;
  }

  encode(run: ReplayRun): string {
    return toBase64Url(JSON.stringify(run));
  }

  decode(value: string): ReplayRun {
    const raw = fromBase64Url(value);
    const parsed = JSON.parse(raw) as ReplayRun;

    if (!parsed || !Array.isArray(parsed.toolCalls)) {
      throw new Error("Invalid replay payload");
    }

    return parsed;
  }

  async replay(run: ReplayRun, runtime: WebMcpRuntime, speedMultiplier = 1): Promise<void> {
    const calls = Array.isArray(run.toolCalls) ? run.toolCalls : [];

    for (let index = 0; index < calls.length; index += 1) {
      const call = calls[index];
      runtime.setScene(`Replay ${index + 1}/${calls.length}: ${call.name}`);

      await runtime.invokeTool(call.name, call.args, "replay");

      const delay = Math.max(0, Math.min(1200, Math.round(call.elapsedMs / Math.max(0.1, speedMultiplier))));
      if (delay > 0) {
        await sleep(delay);
      }
    }

    runtime.setScene("Replay complete");
  }
}
