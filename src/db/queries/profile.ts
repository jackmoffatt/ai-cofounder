import { and, desc, eq, inArray } from "drizzle-orm";
import type { Db } from "../client";
import { LOCAL_OWNER, founder, memoryEvents, startups, type Founder, type MemoryEvent, type Startup } from "../schema";

const now = () => new Date().toISOString();

export function getOrCreateFounder(db: Db): Founder {
  const row = db.select().from(founder).where(eq(founder.ownerId, LOCAL_OWNER)).get();
  if (row) return row;
  const created: Founder = { id: crypto.randomUUID(), ownerId: LOCAL_OWNER, name: null, profile: "{}", updatedAt: now() };
  db.insert(founder).values(created).run();
  return created;
}

export function saveFounder(db: Db, patch: { name?: string | null; profile?: string }): Founder {
  const current = getOrCreateFounder(db);
  const next = { ...patch, updatedAt: now() };
  db.update(founder).set(next).where(eq(founder.id, current.id)).run();
  return { ...current, ...next };
}

export function getActiveStartup(db: Db): Startup | undefined {
  return db
    .select()
    .from(startups)
    .where(and(eq(startups.ownerId, LOCAL_OWNER), eq(startups.status, "active")))
    .orderBy(desc(startups.createdAt))
    .get();
}

export function createStartup(db: Db, name: string): Startup {
  const row: Startup = {
    id: crypto.randomUUID(),
    ownerId: LOCAL_OWNER,
    name,
    status: "active",
    stage: "discovery",
    currentObjective: "",
    profile: "{}",
    createdAt: now(),
    updatedAt: now(),
  };
  db.insert(startups).values(row).run();
  return row;
}

export function updateStartup(
  db: Db,
  id: string,
  patch: Partial<Pick<Startup, "name" | "stage" | "currentObjective" | "profile">>,
): Startup | undefined {
  db.update(startups)
    .set({ ...patch, updatedAt: now() })
    .where(and(eq(startups.id, id), eq(startups.ownerId, LOCAL_OWNER)))
    .run();
  return db.select().from(startups).where(eq(startups.id, id)).get();
}

export interface NewEvent {
  entityType: string;
  entityId: string;
  action: MemoryEvent["action"];
  actor: MemoryEvent["actor"];
  summary: string;
  reason?: string;
  change?: unknown;
  origin?: unknown;
}

export function insertEvent(db: Db, e: NewEvent): MemoryEvent {
  const row: MemoryEvent = {
    id: crypto.randomUUID(),
    entityType: e.entityType,
    entityId: e.entityId,
    action: e.action,
    actor: e.actor,
    summary: e.summary,
    reason: e.reason ?? "",
    change: JSON.stringify(e.change ?? {}),
    origin: JSON.stringify(e.origin ?? {}),
    undoneAt: null,
    createdAt: now(),
  };
  db.insert(memoryEvents).values(row).run();
  return row;
}

export function getEvent(db: Db, id: string): MemoryEvent | undefined {
  return db.select().from(memoryEvents).where(eq(memoryEvents.id, id)).get();
}

export function getEvents(db: Db, ids: string[]): MemoryEvent[] {
  return ids.length ? db.select().from(memoryEvents).where(inArray(memoryEvents.id, ids)).all() : [];
}

export function markEventUndone(db: Db, id: string): void {
  db.update(memoryEvents).set({ undoneAt: now() }).where(eq(memoryEvents.id, id)).run();
}
