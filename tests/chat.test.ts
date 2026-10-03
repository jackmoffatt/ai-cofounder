import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { runChatTurn, type TurnEvent } from "@/agent/chat";
import { cleanTitle, fallbackTitle } from "@/agent/title";
import { createDb, type Db } from "@/db/client";
import { getConversation, listMessages } from "@/db/queries/conversations";
import { FakeProvider } from "@/services/ai/fake";
import { AIError } from "@/services/ai/types";

let db: Db;
beforeEach(() => {
  db = createDb(":memory:");
});

async function collect(gen: AsyncGenerator<TurnEvent>) {
  const out: TurnEvent[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

describe("runChatTurn", () => {
  it("creates a conversation, streams, persists both messages and titles it", async () => {
    const events = await collect(runChatTurn({ db, provider: new FakeProvider() }, { message: "Help me find an idea" }));
    const meta = events.find((e) => e.type === "meta");
    expect(meta).toMatchObject({ isNew: true });
    const id = (meta as { conversationId: string }).conversationId;

    const msgs = listMessages(db, id);
    expect(msgs.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(msgs[1].content).toContain("Help me find an idea");
    expect(events.some((e) => e.type === "done")).toBe(true);
    expect(getConversation(db, id)?.title).toBe("Help me find an");
  });

  it("continues an existing conversation", async () => {
    const first = await collect(runChatTurn({ db, provider: new FakeProvider() }, { message: "one" }));
    const id = (first[0] as { conversationId: string }).conversationId;
    await collect(runChatTurn({ db, provider: new FakeProvider() }, { conversationId: id, message: "two" }));
    expect(listMessages(db, id).map((m) => m.content.slice(0, 12))).toEqual([
      "one",
      'You said: "o',
      "two",
      'You said: "t',
    ]);
  });

  it("surfaces provider failures as a safe error event and keeps the user message", async () => {
    const provider = new FakeProvider({ failWith: new AIError("missing_key") });
    const events = await collect(runChatTurn({ db, provider }, { message: "hello" }));
    const err = events.find((e) => e.type === "error");
    expect(err).toMatchObject({ code: "missing_key" });
    expect((err as { message: string }).message).toContain("ANTHROPIC_API_KEY");
    const id = (events[0] as { conversationId: string }).conversationId;
    expect(listMessages(db, id).map((m) => m.role)).toEqual(["user"]);
  });

  it("regenerates after a failure without duplicating the user message", async () => {
    const failed = await collect(
      runChatTurn({ db, provider: new FakeProvider({ failWith: new AIError("unavailable") }) }, { message: "hi" }),
    );
    const id = (failed[0] as { conversationId: string }).conversationId;
    const retry = await collect(runChatTurn({ db, provider: new FakeProvider() }, { conversationId: id }));
    expect(retry.some((e) => e.type === "done")).toBe(true);
    expect(listMessages(db, id).map((m) => m.role)).toEqual(["user", "assistant"]);
  });

  it("rejects unknown conversations and empty new chats", async () => {
    const p = new FakeProvider();
    expect((await collect(runChatTurn({ db, provider: p }, { conversationId: "nope", message: "x" })))[0]).toMatchObject({
      code: "not_found",
    });
    expect((await collect(runChatTurn({ db, provider: p }, {})))[0]).toMatchObject({ code: "bad_request" });
  });

  it("keeps partial output when the client aborts", async () => {
    const ctrl = new AbortController();
    const gen = runChatTurn({ db, provider: new FakeProvider({ delayMs: 5 }) }, { message: "go", signal: ctrl.signal });
    let id = "";
    for await (const e of gen) {
      if (e.type === "meta") id = e.conversationId;
      if (e.type === "delta") ctrl.abort();
    }
    const msgs = listMessages(db, id);
    expect(msgs[1]?.role).toBe("assistant");
    expect(msgs[1].content).not.toContain("offline development");
  });
});

describe("titles", () => {
  it("cleans model output and truncates fallbacks", () => {
    expect(cleanTitle('"Pricing Strategy."')).toBe("Pricing Strategy");
    expect(fallbackTitle("a".repeat(100)).length).toBe(41);
  });
});
