import type { Db } from "@/db/client";
import { insertEvent } from "@/db/queries/profile";
import {
  getTaskRow,
  getTaskRows,
  insertTaskRow,
  listAllDeps,
  listDepsOf,
  listTaskRows,
  replaceDeps,
  updateTaskRow,
} from "@/db/queries/work";
import { LOCAL_OWNER, type MemoryEvent, type Task } from "@/db/schema";
import {
  PRIORITIES,
  TASK_CATEGORIES,
  TASK_STATUSES,
  compareTasks,
  effectiveStatus,
  isOpen,
  isValidDate,
  type Priority,
  type TaskCategory,
  type TaskStatus,
} from "@/lib/work";

export class WorkError extends Error {}

const now = () => new Date().toISOString();
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").replace(/[.\s]+$/, "").trim();

export interface NewTask {
  title: string;
  description?: string;
  category?: TaskCategory;
  priority?: Priority;
  dueDate?: string | null;
  objectiveId?: string | null;
  experimentId?: string | null;
  startupId?: string | null;
  dependsOn?: string[];
  origin: Task["origin"];
  originRef?: Record<string, unknown>;
  createdBy: "user" | "agent";
  reason?: string;
}

export function createTask(db: Db, input: NewTask): { task: Task; event: MemoryEvent } {
  const title = input.title.replace(/\s+/g, " ").trim().slice(0, 200);
  if (!title) throw new WorkError("Title is required");
  if (input.dueDate && !isValidDate(input.dueDate)) throw new WorkError("Invalid due date");
  const t = now();
  const task: Task = {
    id: crypto.randomUUID(),
    ownerId: LOCAL_OWNER,
    startupId: input.startupId ?? null,
    objectiveId: input.objectiveId ?? null,
    experimentId: input.experimentId ?? null,
    title,
    description: (input.description ?? "").trim().slice(0, 2000),
    category: input.category ?? "other",
    priority: input.priority ?? "medium",
    status: "todo",
    dueDate: input.dueDate ?? null,
    origin: input.origin,
    originRef: JSON.stringify(input.originRef ?? {}),
    createdBy: input.createdBy,
    createdAt: t,
    updatedAt: t,
    completedAt: null,
    deletedAt: null,
  };
  insertTaskRow(db, task);
  if (input.dependsOn?.length) setDependencies(db, task.id, input.dependsOn);
  const event = insertEvent(db, {
    entityType: "task",
    entityId: task.id,
    action: "create",
    actor: input.createdBy,
    summary: `Task: ${task.title}`,
    reason: input.reason ?? "",
    change: { type: "task_created", taskId: task.id },
    origin: input.originRef,
  });
  return { task, event };
}

/** An open task with (nearly) the same title, so repeated mentions don't create duplicates. */
export function findDuplicateTask(db: Db, title: string): Task | undefined {
  const t = norm(title);
  return listTaskRows(db).find((x) => isOpen(x.status) && (norm(x.title) === t || (Math.min(norm(x.title).length, t.length) >= 12 && (norm(x.title).includes(t) || t.includes(norm(x.title))))));
}

/** Rejects self-dependencies, unknown tasks, and cycles. */
export function setDependencies(db: Db, taskId: string, dependsOn: string[]): void {
  const ids = [...new Set(dependsOn)];
  if (ids.includes(taskId)) throw new WorkError("A task can't depend on itself");
  if (getTaskRows(db, ids).filter((t) => !t.deletedAt).length !== ids.length) throw new WorkError("Unknown dependency");
  // Cycle check: would any dependency (transitively) depend on taskId?
  const graph = new Map<string, string[]>();
  for (const d of listAllDeps(db)) graph.set(d.taskId, [...(graph.get(d.taskId) ?? []), d.dependsOnId]);
  const reaches = (from: string, target: string, seen = new Set<string>()): boolean => {
    if (from === target) return true;
    if (seen.has(from)) return false;
    seen.add(from);
    return (graph.get(from) ?? []).some((n) => reaches(n, target, seen));
  };
  if (ids.some((d) => reaches(d, taskId))) throw new WorkError("That would create a dependency loop");
  replaceDeps(db, taskId, ids);
}

export interface TaskPatch {
  title?: string;
  description?: string;
  category?: TaskCategory;
  priority?: Priority;
  status?: TaskStatus;
  dueDate?: string | null;
  dependsOn?: string[];
  objectiveId?: string | null;
}

export function updateTask(db: Db, id: string, patch: TaskPatch, actor: "user" | "agent" = "user", reason = "Edited directly by you"): Task {
  const task = getTaskRow(db, id);
  if (!task || task.deletedAt) throw new WorkError("Not found");
  const next: Partial<Task> = {};
  const changes: string[] = [];

  if (patch.title !== undefined && patch.title.trim() && patch.title.trim() !== task.title) {
    next.title = patch.title.trim().slice(0, 200);
    changes.push("title");
  }
  if (patch.description !== undefined && patch.description.trim() !== task.description) {
    next.description = patch.description.trim().slice(0, 2000);
    changes.push("details");
  }
  if (patch.category !== undefined && patch.category !== task.category) {
    if (!TASK_CATEGORIES.includes(patch.category)) throw new WorkError("Invalid category");
    next.category = patch.category;
    changes.push("category");
  }
  if (patch.priority !== undefined && patch.priority !== task.priority) {
    if (!PRIORITIES.includes(patch.priority)) throw new WorkError("Invalid priority");
    next.priority = patch.priority;
    changes.push("priority");
  }
  if (patch.dueDate !== undefined && patch.dueDate !== task.dueDate) {
    if (patch.dueDate && !isValidDate(patch.dueDate)) throw new WorkError("Invalid due date");
    next.dueDate = patch.dueDate;
    changes.push("due date");
  }
  if (patch.objectiveId !== undefined && patch.objectiveId !== task.objectiveId) next.objectiveId = patch.objectiveId;
  let statusChange: { from: string; to: string } | null = null;
  if (patch.status !== undefined && patch.status !== task.status) {
    if (!TASK_STATUSES.includes(patch.status)) throw new WorkError("Invalid status");
    next.status = patch.status;
    next.completedAt = patch.status === "done" ? now() : null;
    statusChange = { from: task.status, to: patch.status };
    changes.push(patch.status === "done" ? "completed" : `status ${task.status} → ${patch.status}`);
  }
  if (patch.dependsOn !== undefined) {
    setDependencies(db, id, patch.dependsOn);
    changes.push("dependencies");
  }
  if (!changes.length) return task;

  if (Object.keys(next).length) updateTaskRow(db, id, { ...next, updatedAt: now() });
  insertEvent(db, {
    entityType: "task",
    entityId: id,
    action: "update",
    actor,
    summary: statusChange?.to === "done" ? `Task done: ${task.title}` : `Edited task: ${changes.join(", ")}`,
    reason,
    change: statusChange ? { type: "task_status", taskId: id, ...statusChange } : { type: "task_edited", taskId: id },
  });
  return getTaskRow(db, id)!;
}

export function deleteTask(db: Db, id: string, actor: "user" | "agent" = "user"): boolean {
  const task = getTaskRow(db, id);
  if (!task || task.deletedAt) return false;
  updateTaskRow(db, id, { deletedAt: now() });
  insertEvent(db, { entityType: "task", entityId: id, action: "delete", actor, summary: `Deleted task: ${task.title}`, reason: actor === "user" ? "Deleted by you" : "" });
  return true;
}

export function restoreTask(db: Db, id: string): void {
  updateTaskRow(db, id, { deletedAt: null, updatedAt: now() });
}

export interface TaskView {
  id: string;
  title: string;
  description: string;
  category: TaskCategory;
  priority: Priority;
  /** What was stored. */
  status: TaskStatus;
  /** What it effectively is: todo/doing become blocked while a dependency is unfinished. */
  effectiveStatus: string;
  dueDate: string | null;
  overdue: boolean;
  objectiveId: string | null;
  experimentId: string | null;
  dependsOn: string[];
  blockedBy: Array<{ id: string; title: string }>;
  origin: Task["origin"];
  createdBy: Task["createdBy"];
  createdAt: string;
  completedAt: string | null;
}

/** All live tasks, most important first, with dependency state resolved. */
export function listTaskViews(db: Db, today: string): TaskView[] {
  const rows = listTaskRows(db);
  const byId = new Map(rows.map((r) => [r.id, r]));
  const deps = new Map<string, string[]>();
  for (const d of listAllDeps(db)) deps.set(d.taskId, [...(deps.get(d.taskId) ?? []), d.dependsOnId]);

  return rows
    .map((r): TaskView => {
      const dependsOn = (deps.get(r.id) ?? []).filter((id) => byId.has(id));
      const blockedBy = dependsOn.flatMap((id) => {
        const d = byId.get(id)!;
        return isOpen(d.status) ? [{ id, title: d.title }] : [];
      });
      return {
        id: r.id,
        title: r.title,
        description: r.description,
        category: r.category,
        priority: r.priority,
        status: r.status,
        effectiveStatus: effectiveStatus(r.status, blockedBy.length),
        dueDate: r.dueDate,
        overdue: isOpen(r.status) && r.dueDate !== null && r.dueDate < today,
        objectiveId: r.objectiveId,
        experimentId: r.experimentId,
        dependsOn,
        blockedBy,
        origin: r.origin,
        createdBy: r.createdBy,
        createdAt: r.createdAt,
        completedAt: r.completedAt,
      };
    })
    .sort(compareTasks);
}

export { listDepsOf };
