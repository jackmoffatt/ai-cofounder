import { sql } from "drizzle-orm";
import { index, sqliteTable, text } from "drizzle-orm/sqlite-core";

/** Single-user for now: every row carries an owner so auth/multi-user isn't blocked later. */
export const LOCAL_OWNER = "local";

export const conversations = sqliteTable("conversations", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull().default(LOCAL_OWNER),
  title: text("title").notNull().default("New chat"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const messages = sqliteTable(
  "messages",
  {
    id: text("id").primaryKey(),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["user", "assistant"] }).notNull(),
    content: text("content").notNull(),
    /** JSON: model, token usage, interrupted flag, later trace ids and referenced items. */
    metadata: text("metadata").notNull().default(sql`'{}'`),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("messages_conversation_idx").on(t.conversationId, t.createdAt)],
);

export type Conversation = typeof conversations.$inferSelect;
export type Message = typeof messages.$inferSelect;

export const founder = sqliteTable("founder", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull().default(LOCAL_OWNER),
  name: text("name"),
  /** JSON: FounderProfile (lib/profile.ts). */
  profile: text("profile").notNull().default(sql`'{}'`),
  updatedAt: text("updated_at").notNull(),
});

/** V1 uses one active startup, but nothing here prevents several. */
export const startups = sqliteTable("startups", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull().default(LOCAL_OWNER),
  name: text("name").notNull(),
  status: text("status", { enum: ["active", "archived"] }).notNull().default("active"),
  stage: text("stage").notNull().default("discovery"),
  /** Free text until objectives get their own table (M5). */
  currentObjective: text("current_objective").notNull().default(""),
  /** JSON: StartupProfile (lib/profile.ts). */
  profile: text("profile").notNull().default(sql`'{}'`),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

/** Audit trail for everything the agent or the user changes in structured memory. */
export const memoryEvents = sqliteTable(
  "memory_events",
  {
    id: text("id").primaryKey(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    action: text("action", { enum: ["create", "update", "delete"] }).notNull(),
    actor: text("actor", { enum: ["user", "agent"] }).notNull(),
    /** Human-readable summary, e.g. "skills: Python". */
    summary: text("summary").notNull(),
    /** Why it was saved: usually a quote from the user's message. */
    reason: text("reason").notNull().default(""),
    /** JSON: machine-readable change (what undo needs). */
    change: text("change").notNull().default(sql`'{}'`),
    /** JSON: where it came from, e.g. { conversationId, messageId }. */
    origin: text("origin").notNull().default(sql`'{}'`),
    undoneAt: text("undone_at"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("memory_events_entity_idx").on(t.entityType, t.entityId)],
);

export type Founder = typeof founder.$inferSelect;
export type Startup = typeof startups.$inferSelect;
export type MemoryEvent = typeof memoryEvents.$inferSelect;
