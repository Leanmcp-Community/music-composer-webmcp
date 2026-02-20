import type { LlmProvider, ToolInputSchema } from "../types";

export interface AnthropicToolDefinition {
  name: string;
  description: string;
  input_schema: ToolInputSchema;
}

export interface AnthropicToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface AnthropicToolResultBlock {
  type: "tool_result";
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

export interface AnthropicTextBlock {
  type: "text";
  text: string;
}

export type AnthropicMessageContentBlock =
  | AnthropicTextBlock
  | AnthropicToolUseBlock
  | AnthropicToolResultBlock
  | Record<string, unknown>;

export interface AnthropicChatMessage {
  role: "user" | "assistant";
  content: string | AnthropicMessageContentBlock[];
}

export interface LlmRequest {
  provider: LlmProvider;
  model: string;
  apiKey: string;
  system: string;
  messages: AnthropicChatMessage[];
  tools: AnthropicToolDefinition[];
  maxTokens?: number;
  sessionId?: string;
}

interface AnthropicMessagesRequest {
  endpoint: string;
  model: string;
  apiKey: string;
  system: string;
  messages: AnthropicChatMessage[];
  tools: AnthropicToolDefinition[];
  maxTokens?: number;
  sessionId?: string;
}

export interface AnthropicMessagesResponse {
  content: AnthropicMessageContentBlock[];
  stop_reason?: string | null;
}

const DEFAULT_GATEWAY_ORIGIN: string = import.meta.env.VITE_GATEWAY_ORIGIN
  ?? (import.meta.env.DEV ? "" : "https://aigateway.leanmcp.com");

function getGatewayApiKey(requestKey?: string): string {
  return (import.meta.env.VITE_GATEWAY_API_KEY as string | undefined) || requestKey || "";
}

function buildAnthropicMessagesUrl(endpoint: string): string {
  const trimmed = String(endpoint || "").trim();
  if (!trimmed) {
    throw new Error("Endpoint is required.");
  }

  if (trimmed.toLowerCase().endsWith("/v1/messages")) {
    return trimmed;
  }

  return `${trimmed.replace(/\/+$/, "")}/v1/messages`;
}

function buildGatewayFallbackUrl(url: string): string | null {
  const trimmed = String(url || "").trim();
  if (!trimmed) {
    return null;
  }

  if (trimmed.startsWith("/v1/")) {
    return `${DEFAULT_GATEWAY_ORIGIN}${trimmed}`;
  }

  try {
    const parsed = new URL(trimmed);
    const localHost = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
    if (localHost && parsed.pathname.startsWith("/v1/")) {
      return `${DEFAULT_GATEWAY_ORIGIN}${parsed.pathname}${parsed.search}`;
    }
  } catch {
    return null;
  }

  return null;
}

export async function requestAnthropicMessages(
  request: AnthropicMessagesRequest
): Promise<AnthropicMessagesResponse> {
  const primaryUrl = buildAnthropicMessagesUrl(request.endpoint);

  const apiKey = getGatewayApiKey(request.apiKey);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "anthropic-version": "2023-06-01",
    "anthropic-dangerous-direct-browser-access": "true"
  };

  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  if (request.sessionId) {
    headers["leanmcp-session-id"] = request.sessionId;
  }

  const requestBody = JSON.stringify({
    model: request.model,
    system: request.system,
    messages: request.messages,
    tools: request.tools,
    tool_choice: { type: "auto" },
    max_tokens: request.maxTokens ?? 4096,
    temperature: 0.25
  });

  const send = (url: string) =>
    fetch(url, {
      method: "POST",
      headers,
      body: requestBody
    });

  let response = await send(primaryUrl);

  if (!response.ok) {
    let body = await response.text();

    const fallbackUrl = buildGatewayFallbackUrl(primaryUrl);
    const canRetryWithGatewayOrigin =
      response.status === 501 &&
      /Unsupported method/i.test(body) &&
      typeof fallbackUrl === "string" &&
      fallbackUrl.length > 0;

    if (canRetryWithGatewayOrigin) {
      response = await send(fallbackUrl);
      if (!response.ok) {
        body = await response.text();
      }
    }

    if (!response.ok) {
      if (response.status === 401) {
        throw new Error(
          `Anthropic gateway request failed (401). Provide a LeanMCP token in API Key/Authorization. Response: ${body.slice(0, 500)}`
        );
      }
      throw new Error(`Anthropic gateway request failed (${response.status}): ${body.slice(0, 800)}`);
    }
  }

  const responseText = await response.text();
  let payload: AnthropicMessagesResponse;
  try {
    payload = JSON.parse(responseText) as AnthropicMessagesResponse;
  } catch {
    throw new Error(`Gateway returned invalid JSON: ${responseText.slice(0, 300)}`);
  }

  if (!Array.isArray(payload?.content)) {
    throw new Error(`Anthropic response missing content blocks: ${responseText.slice(0, 300)}`);
  }

  return payload;
}

// OpenAI chat completions via gateway (/v1/openai/v1/chat/completions)
async function requestOpenAiMessages(request: Omit<AnthropicMessagesRequest, "endpoint"> & { endpoint: string }): Promise<AnthropicMessagesResponse> {
  const apiKey = getGatewayApiKey(request.apiKey);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  if (request.sessionId) headers["leanmcp-session-id"] = request.sessionId;

  const openAiTools = request.tools.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.input_schema,
    },
  }));

  const openAiMessages: Array<Record<string, unknown>> = [
    { role: "system", content: request.system },
    ...request.messages.map((m) => {
      if (typeof m.content === "string") return { role: m.role, content: m.content };
      const toolResults: Array<Record<string, unknown>> = [];
      const textParts: string[] = [];
      const toolCalls: Array<Record<string, unknown>> = [];
      for (const block of m.content as AnthropicMessageContentBlock[]) {
        const b = block as Record<string, unknown>;
        if (b.type === "tool_result") {
          toolResults.push({
            role: "tool",
            tool_call_id: b.tool_use_id,
            content: typeof b.content === "string" ? b.content : JSON.stringify(b.content),
          });
        } else if (b.type === "tool_use") {
          toolCalls.push({
            id: b.id,
            type: "function",
            function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) },
          });
        } else if (b.type === "text") {
          textParts.push(b.text as string);
        }
      }
      if (toolResults.length > 0) return toolResults;
      if (toolCalls.length > 0) {
        return { role: "assistant", content: textParts.join("\n") || null, tool_calls: toolCalls };
      }
      return { role: m.role, content: textParts.join("\n") };
    }).flat(),
  ];

  const body = JSON.stringify({
    model: request.model,
    messages: openAiMessages,
    tools: openAiTools,
    tool_choice: "auto",
    max_tokens: request.maxTokens ?? 4096,
    temperature: 0.25,
  });

  const url = `${DEFAULT_GATEWAY_ORIGIN}/v1/openai/v1/chat/completions`;
  const response = await fetch(url, { method: "POST", headers, body });

  if (!response.ok) {
    const errText = await response.text();
    if (response.status === 401) {
      throw new Error(`Gateway request failed (401). Sign in to use the agent. Response: ${errText.slice(0, 500)}`);
    }
    throw new Error(`Gateway request failed (${response.status}): ${errText.slice(0, 800)}`);
  }

  const data = await response.json() as {
    choices: Array<{
      message: {
        content: string | null;
        tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>;
      };
    }>;
  };

  const choice = data.choices?.[0]?.message;
  if (!choice) throw new Error("OpenAI response missing choices");

  const content: AnthropicMessageContentBlock[] = [];
  if (choice.content) content.push({ type: "text", text: choice.content });
  if (choice.tool_calls) {
    for (const tc of choice.tool_calls) {
      let input: Record<string, unknown> = {};
      try { input = JSON.parse(tc.function.arguments) as Record<string, unknown>; } catch { /* */ }
      content.push({ type: "tool_use", id: tc.id, name: tc.function.name, input } as AnthropicToolUseBlock);
    }
  }

  return { content, stop_reason: choice.tool_calls?.length ? "tool_use" : "end_turn" };
}

export async function requestLlm(request: LlmRequest): Promise<AnthropicMessagesResponse> {
  if (request.provider === "openai") {
    return requestOpenAiMessages({ ...request, endpoint: `${DEFAULT_GATEWAY_ORIGIN}/v1/openai/v1/chat/completions` });
  }
  return requestAnthropicMessages({ ...request, endpoint: `${DEFAULT_GATEWAY_ORIGIN}/v1/anthropic/v1/messages` });
}
