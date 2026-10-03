import type { AIProvider, ChatEvent, ChatRequest, Usage } from "./types";

/** Deterministic provider for tests and offline UI work (AI_PROVIDER=fake). Echoes the last user message. */
export class FakeProvider implements AIProvider {
  readonly name = "fake";

  constructor(private readonly opts: { delayMs?: number; failWith?: Error } = {}) {}

  async *stream(req: ChatRequest): AsyncIterable<ChatEvent> {
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
    const first = req.messages[0]?.content ?? "";
    return { text: first.split(/\s+/).slice(0, 4).join(" "), usage: { inputTokens: 0, outputTokens: 0 } };
  }
}
