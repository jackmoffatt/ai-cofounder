import type { Db } from "@/db/client";
import { getItem } from "@/db/queries/memory";
import { insertEvent } from "@/db/queries/profile";
import { getExperimentRow, insertExperimentRow, listExperimentRows, updateExperimentRow } from "@/db/queries/work";
import { LOCAL_OWNER, type Experiment } from "@/db/schema";
import { EXPERIMENT_STATUSES, todayLocal } from "@/lib/work";
import { addEvidence } from "@/services/memory/items";
import { readActiveStartup } from "@/services/memory/startup";
import { WorkError } from "./tasks";

const now = () => new Date().toISOString();

export interface NewExperiment {
  hypothesis: string;
  method?: string;
  successCriteria?: string;
  assumptionId?: string | null;
  objectiveId?: string | null;
  createdBy: "user" | "agent";
  reason?: string;
}

export function createExperiment(db: Db, input: NewExperiment): Experiment {
  const hypothesis = input.hypothesis.replace(/\s+/g, " ").trim().slice(0, 400);
  if (!hypothesis) throw new WorkError("Hypothesis is required");
  if (input.assumptionId && !getItem(db, input.assumptionId)) throw new WorkError("Unknown assumption");
  const row: Experiment = {
    id: crypto.randomUUID(),
    ownerId: LOCAL_OWNER,
    startupId: readActiveStartup(db)?.id ?? null,
    objectiveId: input.objectiveId ?? null,
    assumptionId: input.assumptionId ?? null,
    hypothesis,
    method: (input.method ?? "").trim().slice(0, 1000),
    successCriteria: (input.successCriteria ?? "").trim().slice(0, 1000),
    status: "planned",
    startDate: null,
    result: "",
    conclusion: "",
    nextAction: "",
    createdBy: input.createdBy,
    createdAt: now(),
    updatedAt: now(),
  };
  insertExperimentRow(db, row);
  insertEvent(db, { entityType: "experiment", entityId: row.id, action: "create", actor: "user", summary: `Experiment: ${row.hypothesis}`, reason: input.reason ?? "" });
  return row;
}

export type ExperimentPatch = Partial<Pick<Experiment, "hypothesis" | "method" | "successCriteria" | "status" | "result" | "conclusion" | "nextAction">>;

export function updateExperiment(db: Db, id: string, patch: ExperimentPatch): Experiment {
  const row = getExperimentRow(db, id);
  if (!row) throw new WorkError("Not found");
  if (patch.status && !EXPERIMENT_STATUSES.includes(patch.status)) throw new WorkError("Invalid status");
  const next: Partial<Experiment> = { updatedAt: now() };
  const changes: string[] = [];
  for (const k of ["hypothesis", "method", "successCriteria", "status", "result", "conclusion", "nextAction"] as const) {
    if (patch[k] !== undefined && patch[k] !== row[k]) {
      (next as Record<string, unknown>)[k] = patch[k];
      changes.push(k);
    }
  }
  if (!changes.length) return row;
  if (patch.status === "running" && !row.startDate) next.startDate = todayLocal();
  updateExperimentRow(db, id, next);
  insertEvent(db, { entityType: "experiment", entityId: id, action: "update", actor: "user", summary: `Edited experiment: ${changes.join(", ")}`, reason: "Edited directly by you" });
  return getExperimentRow(db, id)!;
}

export interface Completion {
  result: string;
  conclusion?: string;
  nextAction?: string;
  /** If given, the result is also recorded as evidence on the experiment's assumption. */
  evidence?: { stance: "supports" | "weakens"; strength: "anecdotal" | "moderate" | "strong" };
}

/**
 * Closes an experiment. When the founder says what the result means for the assumption, it becomes
 * evidence, which is the only way an experiment moves an assumption's status.
 */
export function completeExperiment(db: Db, id: string, c: Completion): Experiment {
  const row = getExperimentRow(db, id);
  if (!row) throw new WorkError("Not found");
  if (!c.result.trim()) throw new WorkError("Say what happened");
  const exp = updateExperiment(db, id, { status: "completed", result: c.result.trim(), conclusion: c.conclusion?.trim() ?? row.conclusion, nextAction: c.nextAction?.trim() ?? row.nextAction });
  if (c.evidence && row.assumptionId) {
    addEvidence(db, {
      itemId: row.assumptionId,
      stance: c.evidence.stance,
      strength: c.evidence.strength,
      excerpt: `Experiment “${row.hypothesis}”${row.method ? ` (${row.method})` : ""}: ${c.result.trim()}`,
      origin: "manual",
      originRef: { experimentId: id },
      createdBy: "user",
    });
  }
  return exp;
}

export { listExperimentRows };
