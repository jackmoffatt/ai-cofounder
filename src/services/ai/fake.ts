import type { ZodType } from "zod";
import type { AIProvider, ChatEvent, ChatRequest, Usage } from "./types";

/** Deterministic provider for tests and offline UI work (AI_PROVIDER=fake). Echoes the last user message. */
export class FakeProvider implements AIProvider {
  readonly name = "fake";
  /** Every request received, for assertions in tests. */
  readonly requests: ChatRequest[] = [];

  constructor(
    private readonly opts: {
      delayMs?: number;
      failWith?: Error;
      /** What `structured()` returns; defaults to `{}`, which schemas with all-optional fields accept. */
      structuredResult?: unknown | ((req: ChatRequest) => unknown);
      /** What `complete()` returns; defaults to the first four words of the first message (a fake title). */
      completeResult?: (req: ChatRequest) => string;
    } = {},
  ) {}

  async *stream(req: ChatRequest): AsyncIterable<ChatEvent> {
    this.requests.push(req);
    if (this.opts.failWith) throw this.opts.failWith;
    const last = req.messages[req.messages.length - 1]?.content ?? "";
    const reply = `You said: "${last}"\n\nThis is a **fake** reply used for offline development.`;
    for (const word of reply.split(/(?<=\s)/)) {
      if (req.signal?.aborted) return;
      if (this.opts.delayMs) await new Promise((r) => setTimeout(r, this.opts.delayMs));
      yield { type: "text_delta", text: word };
    }
    yield { type: "done", stopReason: "end_turn", usage: { inputTokens: 0, outputTokens: 0 }, model: "fake" };
  }

  async complete(req: ChatRequest): Promise<{ text: string; usage: Usage }> {
    this.requests.push(req);
    if (this.opts.failWith) throw this.opts.failWith;
    const first = req.messages[0]?.content ?? "";
    const text = this.opts.completeResult?.(req) ?? first.split(/\s+/).slice(0, 4).join(" ");
    return { text, usage: { inputTokens: 0, outputTokens: 0 } };
  }

  async structured<T>(req: ChatRequest, schema: ZodType<T>): Promise<{ data: T; usage: Usage }> {
    this.requests.push(req);
    if (this.opts.failWith) throw this.opts.failWith;
    const r = this.opts.structuredResult;
    const raw = typeof r === "function" ? (r as (q: ChatRequest) => unknown)(req) : (r ?? {});
    return { data: schema.parse(raw), usage: { inputTokens: 0, outputTokens: 0 } };
  }
}
