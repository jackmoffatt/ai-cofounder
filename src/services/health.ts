import path from "node:path";
import { sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { MODEL_ROLES, ROLE_INFO, DEFAULTS, modelFor, modelSource, type ModelRole } from "@/services/ai/models";

export interface HealthReport {
  ai: { provider: string; keyConfigured: boolean };
  search: { backend: string; configured: boolean; fake: boolean };
  database: { ok: boolean; path: string };
  models: Array<{ role: ModelRole; label: string; description: string; model: string; defaultModel: string; source: "setting" | "environment" | "default" }>;
}

/** What is configured, without ever revealing a secret: only whether it is present. */
export function healthReport(db: Db): HealthReport {
  const provider = process.env.AI_PROVIDER ?? "anthropic";
  const backend = process.env.SEARCH_BACKEND ?? "anthropic";
  let dbOk = true;
  try {
    db.get(sql`select 1`);
  } catch {
    dbOk = false;
  }
  return {
    ai: { provider, keyConfigured: provider === "fake" ? true : Boolean(process.env.ANTHROPIC_API_KEY) },
    search: {
      backend,
      fake: process.env.RESEARCH_FAKE === "1",
      configured: process.env.RESEARCH_FAKE === "1" || (backend === "brave" ? Boolean(process.env.BRAVE_API_KEY) : Boolean(process.env.ANTHROPIC_API_KEY)),
    },
    database: { ok: dbOk, path: path.resolve(process.env.DATABASE_PATH ?? path.join(process.cwd(), "data", "app.db")) },
    models: MODEL_ROLES.map((role) => ({ role, ...ROLE_INFO[role], model: modelFor(role), defaultModel: DEFAULTS[role], source: modelSource(role) })),
  };
}

/** The first thing stopping chat from working, as a sentence for the founder, or null. */
export function setupProblem(): string | null {
  const provider = process.env.AI_PROVIDER ?? "anthropic";
  if (provider === "anthropic" && !process.env.ANTHROPIC_API_KEY) {
    return "Add your ANTHROPIC_API_KEY to .env.local and restart the server to start chatting.";
  }
  return null;
}
