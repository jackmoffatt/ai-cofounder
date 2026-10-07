import { and, eq, inArray, isNotNull } from "drizzle-orm";
import type { Db } from "@/db/client";
import { memoryEvents, memoryItems, tasks } from "@/db/schema";
import { insertEvent } from "@/db/queries/profile";
import { restoreItem } from "@/services/memory/items";
import { restoreTask } from "@/services/work/tasks";

export type TrashType = "item" | "task";

export interface TrashEntry {
  type: TrashType;
  id: string;
  title: string;
  /** "assumption", "decision", "task"… */
  kind: string;
  deletedAt: string;
}

/** Soft-deleted things, newest first. */
export function listTrash(db: Db): TrashEntry[] {
  const items = db.select().from(memoryItems).where(isNotNull(memoryItems.deletedAt)).all();
  const deletedTasks = db.select().from(tasks).where(isNotNull(tasks.deletedAt)).all();
  return [
    ...items.map((i): TrashEntry => ({ type: "item", id: i.id, title: i.title, kind: i.kind, deletedAt: i.deletedAt! })),
    ...deletedTasks.map((t): TrashEntry => ({ type: "task", id: t.id, title: t.title, kind: "task", deletedAt: t.deletedAt! })),
  ].sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
}

/** Brings something back. Returns false if it isn't in the trash. */
export function restoreFromTrash(db: Db, type: TrashType, id: string): boolean {
  const entry = listTrash(db).find((e) => e.type === type && e.id === id);
  if (!entry) return false;
  if (type === "item") restoreItem(db, id);
  else restoreTask(db, id);
  insertEvent(db, { entityType: type === "item" ? "memory_item" : "task", entityId: id, action: "update", actor: "user", summary: `Restored ${entry.kind}: ${entry.title}`, reason: "Restored by you" });
  return true;
}

/**
 * Deletes something for good: the row, what hangs off it (evidence, source links, dependencies), and
 * its audit history, so nothing about it remains in the database. Only items already in the trash.
 */
export function purgeFromTrash(db: Db, type: TrashType, id: string): boolean {
  const entry = listTrash(db).find((e) => e.type === type && e.id === id);
  if (!entry) return false;
  db.transaction((tx) => {
    if (type === "item") tx.delete(memoryItems).where(and(eq(memoryItems.id, id), isNotNull(memoryItems.deletedAt))).run();
    else tx.delete(tasks).where(and(eq(tasks.id, id), isNotNull(tasks.deletedAt))).run();
    tx.delete(memoryEvents).where(inArray(memoryEvents.entityId, [id])).run();
  });
  return true;
}
