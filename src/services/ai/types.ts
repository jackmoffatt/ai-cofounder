/**
 * Provider-neutral AI types. Application code depends on these, never on a vendor SDK.
 * Deliberately small: tools, structured output and caching hints are added when a milestone needs them.
 */
export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ChatRequest {
  model: string;
  system: string;
  messages: ChatMessage[];
  maxTokens: number;
  /** Reasoning depth where the model supports it. Omit for models that don't. */
  effort?: "low" | "medium" | "high";
  signal?: AbortSignal;
}

export type StopReason = "end_turn" | "max_tokens" | "refusal" | "other";

export interface Usage {
  inputTokens: number;
  outputTokens: number;
}

export type ChatEvent =
  | { type: "text_delta"; text: string }
  | { type: "done"; stopReason: StopReason; usage: Usage; model: string };

export interface AIProvider {
  readonly name: string;
  stream(req: ChatRequest): AsyncIterable<ChatEvent>;
  /** Non-streaming convenience for short utility calls (titles, classification). */
  complete(req: ChatRequest): Promise<{ text: string; usage: Usage }>;
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
