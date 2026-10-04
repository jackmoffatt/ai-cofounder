import type { Db } from "@/db/client";
import { insertEvent } from "@/db/queries/profile";
import { getObjectiveRow, insertObjectiveRow, listObjectiveRows, updateObjectiveRow } from "@/db/queries/work";
import { LOCAL_OWNER, type Objective } from "@/db/schema";
import { OBJECTIVE_STATUSES } from "@/lib/work";
import { WorkError } from "./tasks";
import { readActiveStartup, saveStartupEdit } from "@/services/memory/startup";

const now = () => new Date().toISOString();

export interface NewObjective {
  title: string;
  description?: string;
  successCriteria?: string;
  createdBy: "user" | "agent";
  /** Also set the startup's "current objective" headline. */
  makeCurrent?: boolean;
  reason?: string;
}

export function createObjective(db: Db, input: NewObjective): Objective {
  const title = input.title.replace(/\s+/g, " ").trim().slice(0, 200);
  if (!title) throw new WorkError("Title is required");
  const startup = readActiveStartup(db);
  const row: Objective = {
    id: crypto.randomUUID(),
    ownerId: LOCAL_OWNER,
    startupId: startup?.id ?? null,
    title,
    description: (input.description ?? "").trim().slice(0, 2000),
    successCriteria: (input.successCriteria ?? "").trim().slice(0, 1000),
    status: "active",
    createdBy: input.createdBy,
    createdAt: now(),
    updatedAt: now(),
  };
  insertObjectiveRow(db, row);
  insertEvent(db, {
    entityType: "objective",
    entityId: row.id,
    action: "create",
    actor: "user", // objectives come from the founder directly or from a plan they accepted
    summary: `Objective: ${row.title}`,
    reason: input.reason ?? "",
  });
  if (input.makeCurrent !== false && startup) saveStartupEdit(db, startup.id, { currentObjective: title });
  return row;
}

/** The newest active objective. */
export function currentObjective(db: Db): Objective | undefined {
  return listObjectiveRows(db).find((o) => o.status === "active");
}

export function updateObjective(
  db: Db,
  id: string,
  patch: Partial<Pick<Objective, "title" | "description" | "successCriteria" | "status">>,
): Objective {
  const row = getObjectiveRow(db, id);
  if (!row) throw new WorkError("Not found");
  if (patch.status && !OBJECTIVE_STATUSES.includes(patch.status)) throw new WorkError("Invalid status");
  const next: Partial<Objective> = { updatedAt: now() };
  const changes: string[] = [];
  for (const k of ["title", "description", "successCriteria", "status"] as const) {
    if (patch[k] !== undefined && patch[k] !== row[k]) {
      (next as Record<string, unknown>)[k] = typeof patch[k] === "string" ? (patch[k] as string).trim() : patch[k];
      changes.push(k === "successCriteria" ? "success criteria" : k);
    }
  }
  if (!changes.length) return row;
  updateObjectiveRow(db, id, next);
  insertEvent(db, { entityType: "objective", entityId: id, action: "update", actor: "user", summary: `Edited objective: ${changes.join(", ")}`, reason: "Edited directly by you" });
  return getObjectiveRow(db, id)!;
}
