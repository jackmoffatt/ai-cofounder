import { desc, eq } from "drizzle-orm";
import type { Db } from "../client";
import { LOCAL_OWNER, agentTraces, startupBriefs, type AgentTrace, type StartupBrief } from "../schema";

export function latestBrief(db: Db): StartupBrief | undefined {
  return db.select().from(startupBriefs).where(eq(startupBriefs.ownerId, LOCAL_OWNER)).orderBy(desc(startupBriefs.version)).limit(1).get();
}

export function listBriefs(db: Db, limit = 20): StartupBrief[] {
  return db.select().from(startupBriefs).where(eq(startupBriefs.ownerId, LOCAL_OWNER)).orderBy(desc(startupBriefs.version)).limit(limit).all();
}

export function insertBrief(db: Db, row: Omit<StartupBrief, "id" | "version" | "createdAt" | "ownerId">): StartupBrief {
  const full: StartupBrief = {
    ...row,
    id: crypto.randomUUID(),
    ownerId: LOCAL_OWNER,
    version: (latestBrief(db)?.version ?? 0) + 1,
    createdAt: new Date().toISOString(),
  };
  db.insert(startupBriefs).values(full).run();
  return full;
}

export const insertTrace = (db: Db, row: AgentTrace) => void db.insert(agentTraces).values(row).run();

export const getTraceForMessage = (db: Db, messageId: string): AgentTrace | undefined =>
  db.select().from(agentTraces).where(eq(agentTraces.messageId, messageId)).get();

export const getTrace = (db: Db, id: string): AgentTrace | undefined =>
  db.select().from(agentTraces).where(eq(agentTraces.id, id)).get();

export function lastTraceForConversation(db: Db, conversationId: string): AgentTrace | undefined {
  return db.select().from(agentTraces).where(eq(agentTraces.conversationId, conversationId)).orderBy(desc(agentTraces.createdAt)).limit(1).get();
}
