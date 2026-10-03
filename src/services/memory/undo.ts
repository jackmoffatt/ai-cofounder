import type { Db } from "@/db/client";
import { getEvent, markEventUndone } from "@/db/queries/profile";
import { getItem } from "@/db/queries/memory";
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

  const change = JSON.parse(ev.change) as { type?: string; itemId?: string; evidenceId?: string };
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
