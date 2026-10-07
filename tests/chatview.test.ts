import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createDb, type Db } from "@/db/client";
import { addMessage, createConversation, deleteConversation } from "@/db/queries/conversations";
import { loadChatView } from "@/services/conversations/view";

let db: Db;
beforeEach(() => {
  db = createDb(":memory:");
});

describe("loadChatView", () => {
  it("shapes stored messages for the chat view, and tolerates bad metadata", () => {
    const c = createConversation(db, "Pricing");
    addMessage(db, c.id, "user", "What should we charge?");
    addMessage(db, c.id, "assistant", "Start with **$20**.", { refs: { "m:1": { id: "x", kind: "idea", title: "Pricing idea" } } });
    addMessage(db, c.id, "assistant", "Garbled", "{not json" as never);

    const view = loadChatView(db, c.id);
    expect(view?.title).toBe("Pricing");
    expect(view?.items.map((i) => i.role)).toEqual(["user", "assistant", "assistant"]);
    expect(view?.items[0]).not.toHaveProperty("refs");
    expect(view?.items[1].refs).toEqual({ "m:1": { id: "x", kind: "idea", title: "Pricing idea" } });
    expect(view?.items[2].refs).toEqual({});
    expect(view?.items.every((i) => i.messageId === i.id)).toBe(true);
  });

  it("is null for a missing or deleted conversation", () => {
    expect(loadChatView(db, "00000000-0000-4000-8000-000000000000")).toBeNull();
    const c = createConversation(db);
    deleteConversation(db, c.id);
    expect(loadChatView(db, c.id)).toBeNull();
  });
});
