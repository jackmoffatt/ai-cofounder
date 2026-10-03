import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import type { Db } from "../client";
import {
  LOCAL_OWNER,
  evidence,
  memoryEvents,
  memoryItems,
  proposals,
  type Evidence,
  type MemoryEvent,
  type MemoryItem,
  type Proposal,
} from "../schema";

export const insertItem = (db: Db, row: MemoryItem) => void db.insert(memoryItems).values(row).run();

export function getItem(db: Db, id: string): MemoryItem | undefined {
  return db
    .select()
    .from(memoryItems)
    .where(and(eq(memoryItems.id, id), eq(memoryItems.ownerId, LOCAL_OWNER)))
    .get();
}

export function listItems(db: Db, opts: { kind?: MemoryItem["kind"]; includeDeleted?: boolean } = {}): MemoryItem[] {
  const conds = [eq(memoryItems.ownerId, LOCAL_OWNER)];
  if (!opts.includeDeleted) conds.push(isNull(memoryItems.deletedAt));
  if (opts.kind) conds.push(eq(memoryItems.kind, opts.kind));
  return db
    .select()
    .from(memoryItems)
    .where(and(...conds))
    .orderBy(desc(memoryItems.updatedAt))
    .all();
}

export function updateItemRow(db: Db, id: string, patch: Partial<MemoryItem>): void {
  db.update(memoryItems).set(patch).where(eq(memoryItems.id, id)).run();
}

export const insertEvidenceRow = (db: Db, row: Evidence) => void db.insert(evidence).values(row).run();

export const getEvidenceRow = (db: Db, id: string): Evidence | undefined =>
  db.select().from(evidence).where(eq(evidence.id, id)).get();

export const listEvidence = (db: Db, itemId: string): Evidence[] =>
  db.select().from(evidence).where(eq(evidence.itemId, itemId)).orderBy(asc(evidence.createdAt)).all();

export const deleteEvidenceRow = (db: Db, id: string) => void db.delete(evidence).where(eq(evidence.id, id)).run();

export const insertProposalRow = (db: Db, row: Proposal) => void db.insert(proposals).values(row).run();

export const getProposalRow = (db: Db, id: string): Proposal | undefined =>
  db.select().from(proposals).where(eq(proposals.id, id)).get();

export function listProposalRows(db: Db, status?: Proposal["status"]): Proposal[] {
  return db
    .select()
    .from(proposals)
    .where(status ? and(eq(proposals.ownerId, LOCAL_OWNER), eq(proposals.status, status)) : eq(proposals.ownerId, LOCAL_OWNER))
    .orderBy(desc(proposals.createdAt))
    .all();
}

export const getProposalRows = (db: Db, ids: string[]): Proposal[] =>
  ids.length ? db.select().from(proposals).where(inArray(proposals.id, ids)).all() : [];

export const updateProposalRow = (db: Db, id: string, patch: Partial<Proposal>) =>
  void db.update(proposals).set(patch).where(eq(proposals.id, id)).run();

export function listEventsForEntity(db: Db, entityType: string, entityId: string): MemoryEvent[] {
  return db
    .select()
    .from(memoryEvents)
    .where(and(eq(memoryEvents.entityType, entityType), eq(memoryEvents.entityId, entityId)))
    .orderBy(desc(memoryEvents.createdAt))
    .all();
}
