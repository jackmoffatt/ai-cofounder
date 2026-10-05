/**
 * Provider-neutral AI types. Application code depends on these, never on a vendor SDK.
 * Deliberately small: tools, structured output and caching hints are added when a milestone needs them.
 */
export type ContentPart =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; toolUseId: string; content: string; isError?: boolean };

export interface ChatMessage {
  role: "user" | "assistant";
  content: string | ContentPart[];
  /**
   * Provider-native content for an assistant turn, replayed verbatim when the conversation continues
   * (e.g. after a tool call), so provider-specific blocks such as reasoning stay valid. Opaque to the app.
   */
  native?: unknown;
}

/** The plain text of a message, ignoring tool blocks. */
export const textOf = (content: ChatMessage["content"]): string =>
  typeof content === "string" ? content : content.flatMap((p) => (p.type === "text" ? [p.text] : [])).join("");

/** A tool the model may call. `inputSchema` is JSON Schema (type: object). */
export interface ToolSpec {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface ChatRequest {
  model: string;
  system: string;
  messages: ChatMessage[];
  maxTokens: number;
  /** Reasoning depth where the model supports it. Omit for models that don't. */
  effort?: "low" | "medium" | "high";
  tools?: ToolSpec[];
  signal?: AbortSignal;
}

import type { ZodType } from "zod";

export type StopReason = "end_turn" | "max_tokens" | "refusal" | "tool_use" | "other";

export interface Usage {
  inputTokens: number;
  outputTokens: number;
}

export type ChatEvent =
  | { type: "text_delta"; text: string }
  | { type: "tool_call"; id: string; name: string; input: unknown }
  | { type: "done"; stopReason: StopReason; usage: Usage; model: string; native?: unknown };

export interface AIProvider {
  readonly name: string;
  stream(req: ChatRequest): AsyncIterable<ChatEvent>;
  /** Non-streaming convenience for short utility calls (titles, classification). */
  complete(req: ChatRequest): Promise<{ text: string; usage: Usage }>;
  /** Returns output validated against `schema`. Throws AIError if the model's output doesn't conform. */
  structured<T>(req: ChatRequest, schema: ZodType<T>): Promise<{ data: T; usage: Usage }>;
}

export type AIErrorCode =
  | "missing_key"
  | "auth"
  | "rate_limited"
  | "unavailable"
  | "bad_request"
  | "refused"
  | "aborted"
  | "unknown";

/** Normalized provider failure. `message` is safe to show to the user. */
export class AIError extends Error {
  constructor(
    readonly code: AIErrorCode,
    message?: string,
  ) {
    super(message ?? userMessageFor(code));
    this.name = "AIError";
  }
}

export function userMessageFor(code: AIErrorCode): string {
  switch (code) {
    case "missing_key":
      return "No API key is configured. Add ANTHROPIC_API_KEY to .env.local and restart the server.";
    case "auth":
      return "The AI provider rejected the API key. Check ANTHROPIC_API_KEY in .env.local.";
    case "rate_limited":
      return "The AI provider is rate limiting requests. Wait a moment and try again.";
    case "unavailable":
      return "The AI provider is unavailable right now. Try again shortly.";
    case "bad_request":
      return "The AI provider rejected the request.";
    case "refused":
      return "The model declined to answer this request.";
    case "aborted":
      return "Stopped.";
    default:
      return "Something went wrong talking to the AI provider.";
  }
}
