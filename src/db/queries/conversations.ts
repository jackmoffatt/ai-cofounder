import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "../client";
import { LOCAL_OWNER, conversations, messages, type Conversation, type Message } from "../schema";

const now = () => new Date().toISOString();

export function createConversation(db: Db, title = "New chat"): Conversation {
  const row = { id: crypto.randomUUID(), ownerId: LOCAL_OWNER, title, createdAt: now(), updatedAt: now() };
  db.insert(conversations).values(row).run();
  return row;
}

export function listConversations(db: Db, limit = 200): Conversation[] {
  return db
    .select()
    .from(conversations)
    .where(eq(conversations.ownerId, LOCAL_OWNER))
    .orderBy(desc(conversations.updatedAt))
    .limit(limit)
    .all();
}

export function getConversation(db: Db, id: string): Conversation | undefined {
  return db
    .select()
    .from(conversations)
    .where(and(eq(conversations.id, id), eq(conversations.ownerId, LOCAL_OWNER)))
    .get();
}

export function renameConversation(db: Db, id: string, title: string): boolean {
  return (
    db
      .update(conversations)
      .set({ title })
      .where(and(eq(conversations.id, id), eq(conversations.ownerId, LOCAL_OWNER)))
      .run().changes > 0
  );
}

export function deleteConversation(db: Db, id: string): boolean {
  return (
    db
      .delete(conversations)
      .where(and(eq(conversations.id, id), eq(conversations.ownerId, LOCAL_OWNER)))
      .run().changes > 0
  );
}

export function listMessages(db: Db, conversationId: string): Message[] {
  // rowid preserves insertion order even when two messages share a timestamp.
  return db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(asc(sql`rowid`))
    .all();
}

export function addMessage(
  db: Db,
  conversationId: string,
  role: Message["role"],
  content: string,
  metadata: Record<string, unknown> = {},
): Message {
  const row: Message = {
    id: crypto.randomUUID(),
    conversationId,
    role,
    content,
    metadata: JSON.stringify(metadata),
    createdAt: now(),
  };
  db.insert(messages).values(row).run();
  db.update(conversations).set({ updatedAt: row.createdAt }).where(eq(conversations.id, conversationId)).run();
  return row;
}

/** Merges keys into a message's metadata JSON. */
export function mergeMessageMetadata(db: Db, messageId: string, patch: Record<string, unknown>): void {
  const row = db.select().from(messages).where(eq(messages.id, messageId)).get();
  if (!row) return;
  let current: Record<string, unknown> = {};
  try {
    current = JSON.parse(row.metadata);
  } catch {
    /* keep empty */
  }
  db.update(messages)
    .set({ metadata: JSON.stringify({ ...current, ...patch }) })
    .where(eq(messages.id, messageId))
    .run();
}

/** Turns free text into a safe FTS5 prefix query: each word quoted, last word prefix-matched. */
export function toFtsQuery(input: string): string | null {
  const words = input
    .split(/\s+/)
    .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ""))
    .filter(Boolean);
  if (words.length === 0) return null;
  return words.map((w, i) => (i === words.length - 1 ? `"${w}"*` : `"${w}"`)).join(" ");
}

export interface SearchHit {
  conversation: Conversation;
  snippet: string | null;
}

/** Title matches first, then message-content matches ranked by relevance. */
export function searchConversations(db: Db, query: string, limit = 30): SearchHit[] {
  const q = query.trim();
  if (!q) return [];
  const hits = new Map<string, SearchHit>();

  const escaped = q.replace(/[\\%_]/g, (c) => `\\${c}`);
  for (const c of db
    .select()
    .from(conversations)
    .where(and(eq(conversations.ownerId, LOCAL_OWNER), sql`${conversations.title} LIKE ${`%${escaped}%`} ESCAPE '\\'`))
    .orderBy(desc(conversations.updatedAt))
    .limit(limit)
    .all()) {
    hits.set(c.id, { conversation: c, snippet: null });
  }

  const fts = toFtsQuery(q);
  if (fts) {
    const rows = db.all<{ conversation_id: string; snippet: string }>(sql`
      SELECT conversation_id, snippet(messages_fts, 0, '', '', '…', 12) AS snippet
      FROM messages_fts WHERE messages_fts MATCH ${fts}
      ORDER BY rank LIMIT ${limit * 3}`);
    const ids = [...new Set(rows.map((r) => r.conversation_id))].filter((id) => !hits.has(id));
    if (ids.length) {
      const found = db
        .select()
        .from(conversations)
        .where(and(eq(conversations.ownerId, LOCAL_OWNER), inArray(conversations.id, ids)))
        .all();
      const byId = new Map(found.map((c) => [c.id, c]));
      for (const r of rows) {
        const c = byId.get(r.conversation_id);
        if (c && !hits.has(c.id)) hits.set(c.id, { conversation: c, snippet: r.snippet });
      }
    }
  }
  return [...hits.values()].slice(0, limit);
}
