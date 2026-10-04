import type { Db } from "@/db/client";
import { getEvent, markEventUndone } from "@/db/queries/profile";
import { getItem } from "@/db/queries/memory";
import { getTaskRow } from "@/db/queries/work";
import { deleteTask, updateTask } from "@/services/work/tasks";
import type { TaskStatus } from "@/lib/work";
import { deleteItem, removeEvidence } from "./items";
import { undoFounderEvent, type UndoResult } from "./founder";

/**
 * Reverts something the agent saved. Founder facts remove the single added item; created memory items
 * are soft-deleted; added evidence is removed (and the assumption's status recomputed).
 */
export function undoEvent(db: Db, eventId: string): UndoResult {
  const ev = getEvent(db, eventId);
  if (!ev) return "not_found";
  if (ev.undoneAt) return "already_undone";
  if (ev.actor !== "agent") return "unsupported";
  if (ev.entityType === "founder") return undoFounderEvent(db, eventId);

  const change = JSON.parse(ev.change) as { type?: string; itemId?: string; evidenceId?: string; taskId?: string; from?: string; to?: string };
  if (ev.entityType === "task" && change.taskId) {
    const task = getTaskRow(db, change.taskId);
    if (change.type === "task_created") {
      if (!task || task.deletedAt) return "already_undone";
      deleteTask(db, change.taskId, "user");
    } else if (change.type === "task_status" && change.from) {
      // Only revert if nothing else has touched the status since.
      if (task && !task.deletedAt && task.status === change.to) updateTask(db, change.taskId, { status: change.from as TaskStatus }, "user", "Undid an automatic update");
    } else {
      return "unsupported";
    }
    markEventUndone(db, eventId);
    return "undone";
  }
  if (ev.entityType === "memory_item" && change.type === "item_created" && change.itemId) {
    if (getItem(db, change.itemId)?.deletedAt) return "already_undone";
    deleteItem(db, change.itemId, "user");
  } else if (ev.entityType === "memory_item" && change.type === "evidence_added" && change.evidenceId) {
    removeEvidence(db, change.evidenceId);
  } else {
    return "unsupported";
  }
  markEventUndone(db, eventId);
  return "undone";
}
