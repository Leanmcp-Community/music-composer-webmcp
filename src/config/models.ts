import type { LlmProvider } from "../types";

export interface ModelOption {
  provider: LlmProvider;
  model: string;
  label: string;
  loginRequired?: boolean;
}

export const MODEL_OPTIONS: ModelOption[] = [
  { provider: "openai",    model: "gpt-5.4",            label: "GPT-5.4" },
  { provider: "openai",    model: "gpt-5.4-mini",       label: "GPT-5.4 Mini" },
  { provider: "openai",    model: "gpt-5.4-nano",       label: "GPT-5.4 Nano" },
  { provider: "anthropic", model: "claude-sonnet-4-6",  label: "Claude Sonnet 4.6" },
  { provider: "anthropic", model: "claude-opus-4-6",    label: "Claude Opus 4.6" },
];

export const DEFAULT_MODEL = MODEL_OPTIONS[0];
