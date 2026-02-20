import type { LlmProvider } from "../types";

export interface ModelOption {
  provider: LlmProvider;
  model: string;
  label: string;
  loginRequired?: boolean;
}

export const MODEL_OPTIONS: ModelOption[] = [
  { provider: "openai",    model: "gpt-5.2",           label: "GPT-5.2" },
  { provider: "openai",    model: "gpt-5",              label: "GPT-5" },
  { provider: "openai",    model: "gpt-5-mini",         label: "GPT-5 Mini" },
  { provider: "anthropic", model: "claude-sonnet-4-6",  label: "Claude Sonnet 4.6" },
  { provider: "anthropic", model: "claude-opus-4-6",    label: "Claude Opus 4.6", loginRequired: true },
];

export const DEFAULT_MODEL = MODEL_OPTIONS[0];
