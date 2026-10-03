import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createDb, type Db } from "@/db/client";
import {
  addMessage,
  createConversation,
  deleteConversation,
  getConversation,
  listConversations,
  listMessages,
  renameConversation,
  searchConversations,
  toFtsQuery,
} from "@/db/queries/conversations";

let db: Db;
beforeEach(() => {
  db = createDb(":memory:");
});

describe("conversations", () => {
  it("persists messages in insertion order", () => {
    const c = createConversation(db);
    addMessage(db, c.id, "user", "first");
    addMessage(db, c.id, "assistant", "second");
    addMessage(db, c.id, "user", "third");
    expect(listMessages(db, c.id).map((m) => m.content)).toEqual(["first", "second", "third"]);
  });

  it("lists most recently active conversations first", () => {
    const a = createConversation(db, "A");
    const b = createConversation(db, "B");
    addMessage(db, a.id, "user", "bump");
    expect(listConversations(db).map((c) => c.id)).toEqual([a.id, b.id]);
  });

  it("renames and deletes, cascading messages and search index", () => {
    const c = createConversation(db);
    addMessage(db, c.id, "user", "pricing strategy for students");
    expect(renameConversation(db, c.id, "Pricing")).toBe(true);
    expect(getConversation(db, c.id)?.title).toBe("Pricing");
    expect(deleteConversation(db, c.id)).toBe(true);
    expect(listMessages(db, c.id)).toEqual([]);
    expect(searchConversations(db, "pricing")).toEqual([]);
  });
});

describe("search", () => {
  it("matches titles and message content, with prefix matching", () => {
    const a = createConversation(db, "Competitor research");
    const b = createConversation(db, "Untitled");
    addMessage(db, b.id, "user", "We should talk about onboarding friction");
    expect(searchConversations(db, "competitor").map((h) => h.conversation.id)).toEqual([a.id]);
    const hit = searchConversations(db, "onboard")[0];
    expect(hit.conversation.id).toBe(b.id);
    expect(hit.snippet).toContain("onboarding");
  });

  it("does not choke on FTS syntax characters", () => {
    createConversation(db, "x");
    expect(() => searchConversations(db, `"foo" OR (bar* NEAR`)).not.toThrow();
    expect(toFtsQuery("   ")).toBeNull();
    expect(toFtsQuery('a "b')).toBe('"a" "b"*');
  });

  it("treats LIKE wildcards in titles literally", () => {
    createConversation(db, "100% growth");
    createConversation(db, "other");
    expect(searchConversations(db, "%").length).toBe(1);
  });
});
