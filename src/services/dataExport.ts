import { sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import * as schema from "@/db/schema";

/** Every table that holds the founder's data, by the name it has in the export. */
export const DATA_TABLES = {
  founder: schema.founder,
  startups: schema.startups,
  conversations: schema.conversations,
  messages: schema.messages,
  memoryItems: schema.memoryItems,
  evidence: schema.evidence,
  proposals: schema.proposals,
  memoryEvents: schema.memoryEvents,
  startupBriefs: schema.startupBriefs,
  objectives: schema.objectives,
  experiments: schema.experiments,
  tasks: schema.tasks,
  taskDeps: schema.taskDeps,
  sources: schema.sources,
  researchSources: schema.researchSources,
  competitors: schema.competitors,
  agentTraces: schema.agentTraces,
  approvals: schema.approvals,
} as const;

export type DataTableName = keyof typeof DATA_TABLES;

export interface ExportFile {
  format: "cofounder-export";
  version: 1;
  exportedAt: string;
  /** Row counts, so a reader can check nothing is missing. */
  counts: Record<string, number>;
  data: Record<string, unknown[]>;
}

/**
 * Everything the app stores about the founder and the startup, as plain JSON. Includes soft-deleted
 * rows (marked by deletedAt) so an export is a complete record. API keys are never stored, so none can appear.
 */
export function exportAll(db: Db, now = new Date()): ExportFile {
  const data: Record<string, unknown[]> = {};
  for (const [name, table] of Object.entries(DATA_TABLES)) data[name] = db.select().from(table).all();
  return {
    format: "cofounder-export",
    version: 1,
    exportedAt: now.toISOString(),
    counts: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, v.length])),
    data,
  };
}

/**
 * Permanently deletes all of the founder's data. Settings (model choices) are kept. One transaction:
 * either everything goes or nothing does.
 */
export function deleteAllData(db: Db): void {
  db.transaction((tx) => {
    for (const table of Object.values(DATA_TABLES)) tx.delete(table).run();
    // Full-text indexes are cleared by triggers; this is a belt-and-braces check that nothing is left behind.
    tx.run(sql`DELETE FROM messages_fts`);
    tx.run(sql`DELETE FROM memory_items_fts`);
  });
}
