import type { Db } from "@/db/client";
import {
  deleteEvidenceRow,
  getEvidenceRow,
  getItem,
  insertEvidenceRow,
  insertItem,
  listEvidence,
  listItems,
  updateItemRow,
} from "@/db/queries/memory";
import { insertEvent } from "@/db/queries/profile";
import { LOCAL_OWNER, type Evidence, type MemoryEvent, type MemoryItem } from "@/db/schema";
import { deriveAssumptionState } from "@/lib/epistemics";
import {
  CONFIDENCES,
  KIND_LABELS,
  STATUSES,
  isValidStatus,
  type Confidence,
  type ItemKind,
} from "@/lib/memory";

const now = () => new Date().toISOString();
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").replace(/[.\s]+$/, "").trim();

export interface NewItem {
  kind: ItemKind;
  title: string;
  body?: string;
  importance?: number;
  data?: Record<string, unknown>;
  origin: MemoryItem["origin"];
  originRef?: Record<string, unknown>;
  createdBy: "user" | "agent";
  startupId?: string | null;
  supersedesId?: string | null;
  /** Why it was saved (a quote from the founder, usually). Shown in the audit trail. */
  reason?: string;
}

const clampImportance = (n: number | undefined) => Math.min(5, Math.max(1, Math.round(n ?? 3)));

/**
 * Creates a memory item. New assumptions are *always* untested with low confidence, whoever asks:
 * only evidence (or a human decision) changes that later.
 */
export function createItem(db: Db, input: NewItem): { item: MemoryItem; event: MemoryEvent } {
  const title = input.title.replace(/\s+/g, " ").trim().slice(0, 300);
  if (!title) throw new Error("Title is required");
  const t = now();
  const item: MemoryItem = {
    id: crypto.randomUUID(),
    ownerId: LOCAL_OWNER,
    startupId: input.startupId ?? null,
    kind: input.kind,
    title,
    body: (input.body ?? "").trim().slice(0, 4000),
    status: STATUSES[input.kind][0],
    confidence: "low",
    importance: clampImportance(input.importance),
    data: JSON.stringify(input.data ?? {}),
    origin: input.origin,
    originRef: JSON.stringify(input.originRef ?? {}),
    createdBy: input.createdBy,
    supersedesId: input.supersedesId ?? null,
    createdAt: t,
    updatedAt: t,
    deletedAt: null,
  };
  insertItem(db, item);
  const event = insertEvent(db, {
    entityType: "memory_item",
    entityId: item.id,
    action: "create",
    actor: input.createdBy,
    summary: `${KIND_LABELS[item.kind].singular}: ${item.title}`,
    reason: input.reason ?? "",
    change: { type: "item_created", itemId: item.id },
    origin: input.originRef,
  });
  return { item, event };
}

/** A near-identical live item of the same kind, so repeated mentions don't pile up duplicates. */
export function findDuplicate(db: Db, kind: ItemKind, title: string): MemoryItem | undefined {
  const t = norm(title);
  return listItems(db, { kind }).find((i) => {
    const n = norm(i.title);
    return n === t || (Math.min(n.length, t.length) >= 12 && (n.includes(t) || t.includes(n)));
  });
}

export interface ItemPatch {
  title?: string;
  body?: string;
  status?: string;
  confidence?: Confidence;
  importance?: number;
  data?: Record<string, unknown>;
}

export class MemoryError extends Error {}

/** Edits by the founder. Any valid status is allowed; the audit trail records the change. */
export function updateItem(db: Db, id: string, patch: ItemPatch, actor: "user" | "agent" = "user", reason = "Edited directly by you"): MemoryItem {
  const item = getItem(db, id);
  if (!item || item.deletedAt) throw new MemoryError("Not found");
  const next: Partial<MemoryItem> = {};
  const changes: string[] = [];

  if (patch.title !== undefined && patch.title.trim() && patch.title.trim() !== item.title) {
    next.title = patch.title.trim().slice(0, 300);
    changes.push("title");
  }
  if (patch.body !== undefined && patch.body.trim() !== item.body) {
    next.body = patch.body.trim().slice(0, 4000);
    changes.push("details");
  }
  if (patch.status !== undefined && patch.status !== item.status) {
    if (!isValidStatus(item.kind, patch.status)) throw new MemoryError(`Invalid status for ${item.kind}`);
    next.status = patch.status;
    changes.push(`status ${item.status} → ${patch.status}`);
  }
  if (patch.confidence !== undefined && patch.confidence !== item.confidence) {
    if (!CONFIDENCES.includes(patch.confidence)) throw new MemoryError("Invalid confidence");
    next.confidence = patch.confidence;
    changes.push(`confidence ${item.confidence} → ${patch.confidence}`);
  }
  if (patch.importance !== undefined && clampImportance(patch.importance) !== item.importance) {
    next.importance = clampImportance(patch.importance);
    changes.push("importance");
  }
  if (patch.data !== undefined) {
    next.data = JSON.stringify({ ...JSON.parse(item.data), ...patch.data });
    changes.push("details");
  }
  if (!changes.length) return item;

  next.updatedAt = now();
  updateItemRow(db, id, next);
  insertEvent(db, {
    entityType: "memory_item",
    entityId: id,
    action: "update",
    actor,
    summary: `Edited ${KIND_LABELS[item.kind].singular.toLowerCase()}: ${[...new Set(changes)].join(", ")}`,
    reason,
    change: { type: "item_edited", before: { status: item.status, confidence: item.confidence } },
  });
  return getItem(db, id)!;
}

/** Soft delete: hidden everywhere and from the agent, but restorable (and kept in the audit trail). */
export function deleteItem(db: Db, id: string, actor: "user" | "agent" = "user"): boolean {
  const item = getItem(db, id);
  if (!item || item.deletedAt) return false;
  updateItemRow(db, id, { deletedAt: now() });
  insertEvent(db, {
    entityType: "memory_item",
    entityId: id,
    action: "delete",
    actor,
    summary: `Deleted ${KIND_LABELS[item.kind].singular.toLowerCase()}: ${item.title}`,
    reason: actor === "user" ? "Deleted by you" : "",
  });
  return true;
}

export function restoreItem(db: Db, id: string): void {
  updateItemRow(db, id, { deletedAt: null, updatedAt: now() });
}

export interface NewEvidence {
  itemId: string;
  stance: Evidence["stance"];
  strength: Evidence["strength"];
  excerpt: string;
  origin: Evidence["origin"];
  originRef?: Record<string, unknown>;
  createdBy: "user" | "agent";
}

/** Recomputes an assumption's status and confidence from its evidence. Other kinds are untouched. */
export function recomputeAssumption(db: Db, itemId: string): void {
  const item = getItem(db, itemId);
  if (!item || item.kind !== "assumption") return;
  const state = deriveAssumptionState(listEvidence(db, itemId), item.status);
  if (state.status !== item.status || state.confidence !== item.confidence) {
    updateItemRow(db, itemId, { status: state.status, confidence: state.confidence, updatedAt: now() });
  }
}

export function addEvidence(db: Db, input: NewEvidence): { evidence: Evidence; event: MemoryEvent } {
  const item = getItem(db, input.itemId);
  if (!item || item.deletedAt) throw new MemoryError("Not found");
  const row: Evidence = {
    id: crypto.randomUUID(),
    itemId: input.itemId,
    stance: input.stance,
    strength: input.strength,
    excerpt: input.excerpt.replace(/\s+/g, " ").trim().slice(0, 1000),
    origin: input.origin,
    originRef: JSON.stringify(input.originRef ?? {}),
    createdBy: input.createdBy,
    createdAt: now(),
  };
  insertEvidenceRow(db, row);
  recomputeAssumption(db, input.itemId);
  updateItemRow(db, input.itemId, { updatedAt: now() });
  const event = insertEvent(db, {
    entityType: "memory_item",
    entityId: input.itemId,
    action: "update",
    actor: input.createdBy,
    summary: `${input.stance === "supports" ? "Supporting" : "Contradicting"} evidence for “${item.title}”`,
    reason: row.excerpt,
    change: { type: "evidence_added", evidenceId: row.id, itemId: input.itemId },
    origin: input.originRef,
  });
  return { evidence: row, event };
}

export function removeEvidence(db: Db, evidenceId: string): boolean {
  const row = getEvidenceRow(db, evidenceId);
  if (!row) return false;
  deleteEvidenceRow(db, evidenceId);
  recomputeAssumption(db, row.itemId);
  return true;
}
