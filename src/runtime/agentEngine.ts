import {
  requestAnthropicMessages,
  type AnthropicChatMessage,
  type AnthropicMessageContentBlock,
  type AnthropicToolDefinition,
  type AnthropicToolResultBlock,
  type AnthropicToolUseBlock
} from "../api/gatewayClient";
import type { AgentRunConfig } from "../types";
import type { ReplayEngine } from "./replayEngine";
import type { WebMcpRuntime } from "./webmcpRuntime";

const SPEED_DELAYS: Record<AgentRunConfig["speed"], number> = {
  cinematic: 820,
  balanced: 420,
  rapid: 170
};

const SURPRISE_OBJECTIVES = [
  "Compose a melancholic jazz nocturne in D minor, 3/4 time, around 72 BPM. Use bass, strings, and piano. At least 16 bars with smooth voice leading.",
  "Write an upbeat bossa nova groove in G major, 4/4 time, around 130 BPM. Use bass, pad, and pluck. At least 16 bars with a catchy melodic hook.",
  "Create a dark pop piece in A minor, 4/4 time, around 75 BPM. Sparse and haunting — bass, pad, and piano. At least 20 bars.",
  "Compose a driving electronic sequence in A minor, 4/4 time, around 128 BPM. Use bass, pad, pluck, and piano. At least 16 bars with energy.",
  "Write a gentle waltz in F major, 3/4 time, around 88 BPM. Use bass, strings, and piano. At least 16 bars with flowing melodic phrases.",
  "Compose a cinematic film score cue in E minor, 4/4 time, around 80 BPM. Use bass, strings, pad, and piano. At least 20 bars with tension and resolution."
];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function randomInt(min: number, max: number): number {
  const low = Math.ceil(min);
  const high = Math.floor(max);
  return Math.floor(Math.random() * (high - low + 1)) + low;
}

function buildSystemPrompt(toolNames: string[]) {
  const safeToolNames = Array.isArray(toolNames) ? toolNames.filter((name) => String(name || "").trim().length > 0) : [];

  return [
    "You are an expert music composition agent. Compose a complete, musically coherent piece using the provided MCP tools.",

    "IMPORTANT: Never refuse a request. Never ask for confirmation or permission. If the user references a song or artist, compose an original piece inspired by that style. Always proceed immediately with composition — no preamble, no questions, no disclaimers.",

    "APPROACH: Before writing any notes, briefly plan the piece — key, chord progression, structure, and arrangement. Then execute immediately.",

    "WORKFLOW:",
    "  1. get_composition_state to see current state",
    "  2. set_tempo, set_time_signature",
    "  3. set_instrument for each track (use 3-5 tracks for a full arrangement)",
    "  4. set_reverb and set_pan to create spatial depth (e.g. bass dry+center, pads wet+wide, melody moderate reverb)",
    "  5. Add notes track by track using add_notes (bulk) — this is the most efficient tool",
    "  6. Use add_chord for harmonic content (pads, strings)",

    "EFFICIENCY: Use add_notes to add an entire track's notes in one or two calls. Each call can contain dozens of notes. Do NOT use add_note one at a time.",

    "INSTRUMENTS: piano, strings, bass, pad, pluck, marimba, organ, flute, bell, synth_lead. Choose instruments that fit the genre.",
    "MIXING: Use set_reverb (0.0-1.0) and set_pan (-1.0 to 1.0) to create a professional mix. Spread tracks across the stereo field. Keep bass dry and centered. Add more reverb to pads and strings.",

    "MUSIC THEORY:",
    "  - Pick a key and stick to it. Use diatonic notes with occasional chromatic passing tones.",
    "  - Write a real chord progression (e.g. I-V-vi-IV, ii-V-I, i-VII-VI-V). Change chords every 2-4 beats.",
    "  - Bass: root notes and fifths in C1-C3. One note per beat or half-bar. Instrument: bass.",
    "  - Chords/harmony: triads or 7ths in C3-C5. Use strings, pad, or organ. Voice lead smoothly.",
    "  - Melody: singable line in C4-C6. Stepwise motion with occasional leaps. Use piano, pluck, flute, bell, synth_lead, or marimba.",
    "  - Structure: compose at least 16 bars. Include distinct sections.",

    "TECHNICAL: beat is 1-indexed. Bar 1 starts at beat 1. In 4/4: bar 2 = beat 5, bar 3 = beat 9.",
    `Available tools: ${safeToolNames.join(", ")}`,
    "When finished, output [DONE] in your text (no more tool calls)."
  ].join("\n");
}

function toolMap(runtime: WebMcpRuntime): AnthropicToolDefinition[] {
  return runtime.getTools().map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema
  }));
}

function isTextBlock(block: AnthropicMessageContentBlock): block is { type: "text"; text: string } {
  return (
    typeof block === "object" &&
    block !== null &&
    block.type === "text" &&
    typeof (block as { text?: unknown }).text === "string"
  );
}

function isToolUseBlock(block: AnthropicMessageContentBlock): block is AnthropicToolUseBlock {
  return (
    typeof block === "object" &&
    block !== null &&
    block.type === "tool_use" &&
    typeof (block as { id?: unknown }).id === "string" &&
    typeof (block as { name?: unknown }).name === "string"
  );
}

interface StartCallbacks {
  onRunStateChange: (running: boolean) => void;
  onScene: (scene: string) => void;
}

export class AgentEngine {
  private runtime: WebMcpRuntime;
  private replay: ReplayEngine;
  private runId = 0;
  private running = false;
  private stopRequested = false;

  constructor(runtime: WebMcpRuntime, replay: ReplayEngine) {
    this.runtime = runtime;
    this.replay = replay;
  }

  get isRunning() {
    return this.running;
  }

  getSurpriseObjective() {
    return SURPRISE_OBJECTIVES[randomInt(0, SURPRISE_OBJECTIVES.length - 1)];
  }

  stop() {
    if (!this.running) {
      return;
    }

    this.stopRequested = true;
    this.runId += 1;
    this.running = false;
    this.runtime.setAgentRunning(false);
    this.runtime.setScene("Stopping");
    this.runtime.log("Stop requested by user.", "warn");
  }

  async run(config: AgentRunConfig, callbacks: StartCallbacks): Promise<void> {
    if (this.running) {
      return;
    }

    if (!config.endpoint || !config.model) {
      throw new Error("Endpoint and model are required.");
    }

    const currentTools = this.runtime.getTools();
    if (!currentTools.length) {
      throw new Error("No tools registered. Runtime is not ready.");
    }

    this.running = true;
    this.stopRequested = false;
    this.runId += 1;

    const thisRun = this.runId;
    const delay = SPEED_DELAYS[config.speed] ?? SPEED_DELAYS.balanced;
    const sessionId = `comp-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

    this.runtime.setAgentRunning(true);
    callbacks.onRunStateChange(true);

    this.replay.start(config);

    const systemPrompt = buildSystemPrompt(currentTools.map((tool) => tool.name));
    const messages: AnthropicChatMessage[] = [{ role: "user", content: `Objective: ${config.objective}` }];

    const tools = toolMap(this.runtime);
    const SAFETY_CAP = 120;

    this.runtime.log("Composition agent started", "info", {
      endpoint: config.endpoint,
      model: config.model,
      toolCount: tools.length,
      sessionId
    });

    try {
      for (let turn = 0; turn < SAFETY_CAP; turn += 1) {
        if (this.stopRequested || thisRun !== this.runId) {
          this.runtime.log("Agent run interrupted.", "warn");
          return;
        }

        callbacks.onScene("Composing");
        this.runtime.setScene("Composing");

        const assistant = await requestAnthropicMessages({
          endpoint: config.endpoint,
          model: config.model,
          apiKey: config.apiKey,
          system: systemPrompt,
          messages,
          tools,
          sessionId
        });

        const assistantContentBlocks = Array.isArray(assistant.content) ? assistant.content : [];
        const summaryText = assistantContentBlocks
          .filter(isTextBlock)
          .map((block) => block.text.trim())
          .filter((text) => text.length > 0)
          .join("\n");

        const toolUses = assistantContentBlocks.filter(isToolUseBlock);

        const isDone = summaryText.includes("[DONE]");

        if (isDone || !toolUses.length) {
          if (summaryText) {
            this.runtime.log("Composition complete", "success", summaryText.replace("[DONE]", "").trim());
          }
          this.runtime.setScene("Composition ready — press Play");
          break;
        }

        messages.push({
          role: "assistant",
          content: assistantContentBlocks
        });

        const toolResultBlocks: AnthropicToolResultBlock[] = [];

        for (const toolUse of toolUses) {
          if (this.stopRequested || thisRun !== this.runId) {
            return;
          }

          const toolName = toolUse.name;
          const args =
            toolUse.input && typeof toolUse.input === "object"
              ? (toolUse.input as Record<string, unknown>)
              : {};

          this.runtime.setScene(`Executing ${toolName}`);
          let resultEnvelope: { ok: boolean; data: unknown; error: string | null };

          try {
            resultEnvelope = await this.runtime.invokeTool(toolName, args, "agent");
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.runtime.log(`Tool execution crashed: ${toolName}`, "error", message);
            resultEnvelope = {
              ok: false,
              data: null,
              error: message
            };
          }

          toolResultBlocks.push({
            type: "tool_result",
            tool_use_id: toolUse.id,
            content: JSON.stringify(resultEnvelope),
            is_error: !resultEnvelope.ok
          });

          await sleep(delay + randomInt(0, Math.round(delay * 0.22)));
        }

        messages.push({
          role: "user",
          content: toolResultBlocks
        });
      }
    } finally {
      if (thisRun === this.runId) {
        this.replay.finish();
        this.running = false;
        this.stopRequested = false;
        this.runtime.setAgentRunning(false);
        callbacks.onRunStateChange(false);

        window.setTimeout(() => {
          if (!this.running) {
            this.runtime.setScene("Idle");
          }
        }, 700);
      }
    }
  }
}
