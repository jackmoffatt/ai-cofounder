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
