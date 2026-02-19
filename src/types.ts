export type PropertyType = "string" | "number" | "integer" | "boolean" | "array" | "object";

export interface SchemaProperty {
  type?: PropertyType;
  description?: string;
  enum?: Array<string | number | boolean>;
  items?: SchemaProperty;
  properties?: Record<string, SchemaProperty>;
  required?: string[];
}

export interface ToolInputSchema {
  type: "object";
  properties: Record<string, SchemaProperty>;
  required: string[];
}

export interface ToolClient {
  requestUserInteraction: <T>(callback: () => Promise<T> | T) => Promise<T>;
}

export interface ModelContextTool {
  name: string;
  description: string;
  inputSchema: ToolInputSchema;
  annotations?: {
    readOnlyHint?: boolean;
  };
  execute: (params: Record<string, unknown>, client: ToolClient) => Promise<unknown> | unknown;
}

export interface RuntimeLogEntry {
  at: number;
  level: "info" | "warn" | "error" | "success";
  message: string;
  payload?: unknown;
}

export interface RuntimeMetrics {
  totalCalls: number;
  successCalls: number;
  failedCalls: number;
  queueDepth: number;
  runtimeMs: number;
}

export interface ToolCallRecord {
  name: string;
  args: Record<string, unknown>;
  source: string;
  at: number;
  elapsedMs: number;
  ok: boolean;
  result?: unknown;
  error?: string;
}

export interface ReplayRun {
  version: number;
  objective: string;
  model: string;
  endpoint: string;
  seed: number;
  startedAt: string;
  completedAt?: string;
  toolCalls: ToolCallRecord[];
}

export interface AgentRunConfig {
  objective: string;
  endpoint: string;
  model: string;
  apiKey: string;
  speed: "cinematic" | "balanced" | "rapid";
}

export interface LlmChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: {
      name: string;
      arguments: string;
    };
  }>;
}

export type InstrumentName = "piano" | "strings" | "bass" | "pad" | "pluck" | "marimba" | "organ" | "flute" | "bell" | "synth_lead" | "kick" | "snare" | "hihat" | "clap" | "guitar" | "electric_piano";

export interface MusicNote {
  id: string;
  track: string;
  pitch: string;
  beat: number;
  duration: number;
  velocity: number;
  addedAt: number;
}

export interface SynthParams {
  waveform?: "sine" | "sawtooth" | "square" | "triangle";
  filterCutoff?: number;
  filterQ?: number;
  attack?: number;
  release?: number;
  detune?: number;
}

export type DistortionType = "overdrive" | "hard_clip" | "fuzz" | "saturation" | "bitcrush";

export interface DistortionParams {
  type: DistortionType;
  drive: number;
  mix: number;
  outputGain: number;
}

export interface DelayParams {
  time: number;
  feedback: number;
  mix: number;
}

export interface LfoParams {
  type: "vibrato" | "tremolo";
  rate: number;
  depth: number;
}

export interface MusicTrack {
  name: string;
  instrument: InstrumentName;
  volume: number;
  reverb: number;
  pan: number;
  synthParams?: SynthParams;
  distortion?: DistortionParams;
  delayParams?: DelayParams;
  lfoParams?: LfoParams;
}

export interface CompositionState {
  bpm: number;
  timeSignatureNumerator: number;
  timeSignatureDenominator: number;
  tracks: Record<string, MusicTrack>;
  notes: MusicNote[];
  totalBeats: number;
}
