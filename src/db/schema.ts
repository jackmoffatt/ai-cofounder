import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/** Single-user for now: every row carries an owner so auth/multi-user isn't blocked later. */
export const LOCAL_OWNER = "local";

export const conversations = sqliteTable("conversations", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull().default(LOCAL_OWNER),
  title: text("title").notNull().default("New chat"),
  /** Rolling summary of the oldest messages, so long chats don't have to be resent in full. */
  summary: text("summary").notNull().default(""),
  /** How many messages (from the start) the summary covers. */
  summaryCount: integer("summary_count").notNull().default(0),
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

/**
 * One table for the knowledge kinds that share a lifecycle: assumptions, decisions, questions, ideas,
 * customer insights, notes. Kind-specific extras live in `data` JSON. Soft-deleted via deletedAt.
 */
export const memoryItems = sqliteTable(
  "memory_items",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull().default(LOCAL_OWNER),
    /** Null until an idea becomes an established startup. */
    startupId: text("startup_id"),
    kind: text("kind", { enum: ["assumption", "decision", "question", "idea", "insight", "note"] }).notNull(),
    title: text("title").notNull(),
    body: text("body").notNull().default(""),
    /** Vocabulary depends on kind; validated in services/memory/items.ts. */
    status: text("status").notNull(),
    confidence: text("confidence", { enum: ["low", "medium", "high"] }).notNull().default("low"),
    importance: integer("importance").notNull().default(3),
    /** JSON, kind-specific: decision reasoning/alternatives, assumption category, question method, etc. */
    data: text("data").notNull().default(sql`'{}'`),
    origin: text("origin", { enum: ["conversation", "manual", "research", "import"] }).notNull(),
    /** JSON, e.g. { conversationId, messageId, quote }. */
    originRef: text("origin_ref").notNull().default(sql`'{}'`),
    createdBy: text("created_by", { enum: ["user", "agent"] }).notNull(),
    supersedesId: text("supersedes_id"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    deletedAt: text("deleted_at"),
  },
  (t) => [index("memory_items_kind_idx").on(t.kind, t.status)],
);

/** What supports or weakens an item. Assumption status and confidence are derived from these in code. */
export const evidence = sqliteTable(
  "evidence",
  {
    id: text("id").primaryKey(),
    itemId: text("item_id")
      .notNull()
      .references(() => memoryItems.id, { onDelete: "cascade" }),
    stance: text("stance", { enum: ["supports", "weakens"] }).notNull(),
    strength: text("strength", { enum: ["anecdotal", "moderate", "strong"] }).notNull(),
    /** What was observed, in the founder's words where possible. */
    excerpt: text("excerpt").notNull(),
    origin: text("origin", { enum: ["conversation", "manual", "research"] }).notNull(),
    originRef: text("origin_ref").notNull().default(sql`'{}'`),
    createdBy: text("created_by", { enum: ["user", "agent"] }).notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("evidence_item_idx").on(t.itemId)],
);

/** Changes the agent suggests but must not make itself: anything that alters the company's direction. */
export const proposals = sqliteTable(
  "proposals",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull().default(LOCAL_OWNER),
    /** startup_field | stage | objective | assumption_status | decision_supersede */
    type: text("type").notNull(),
    /** JSON payload for that type. */
    change: text("change").notNull(),
    /** One-line human description, e.g. "Change target customer to bootcamp students". */
    summary: text("summary").notNull(),
    rationale: text("rationale").notNull().default(""),
    status: text("status", { enum: ["pending", "accepted", "rejected"] }).notNull().default("pending"),
    originRef: text("origin_ref").notNull().default(sql`'{}'`),
    createdAt: text("created_at").notNull(),
    decidedAt: text("decided_at"),
  },
  (t) => [index("proposals_status_idx").on(t.status)],
);

export type MemoryItem = typeof memoryItems.$inferSelect;
export type Evidence = typeof evidence.$inferSelect;
export type Proposal = typeof proposals.$inferSelect;

/** Versioned, AI-written snapshot of the company. Latest is included in context; history is kept. */
export const startupBriefs = sqliteTable(
  "startup_briefs",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull().default(LOCAL_OWNER),
    startupId: text("startup_id"),
    version: integer("version").notNull(),
    /** Narrative (model-written) plus status sections (rendered from the database by code). */
    content: text("content").notNull(),
    /** JSON: { action, why } for the recommended next action. */
    nextAction: text("next_action").notNull().default(sql`'{}'`),
    /** What triggered generation: first | stale | manual */
    reason: text("reason").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("startup_briefs_created_idx").on(t.createdAt)],
);

/** One row per agent turn: what the agent saw and did. For development and trust, not for the model. */
export const agentTraces = sqliteTable(
  "agent_traces",
  {
    id: text("id").primaryKey(),
    conversationId: text("conversation_id").notNull(),
    messageId: text("message_id"),
    mode: text("mode").notNull(),
    /** JSON: intent, sections with token estimates, retrieved items and why. */
    context: text("context").notNull(),
    /** JSON: memory event ids and proposal ids produced after the reply. */
    outputs: text("outputs").notNull().default(sql`'{}'`),
    model: text("model").notNull().default(""),
    tokensIn: integer("tokens_in").notNull().default(0),
    tokensOut: integer("tokens_out").notNull().default(0),
    latencyMs: integer("latency_ms").notNull().default(0),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("agent_traces_conv_idx").on(t.conversationId)],
);

export type StartupBrief = typeof startupBriefs.$inferSelect;
export type AgentTrace = typeof agentTraces.$inferSelect;
