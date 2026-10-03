import type { Db } from "@/db/client";
import {
  getEvent,
  getOrCreateFounder,
  insertEvent,
  markEventUndone,
  saveFounder,
} from "@/db/queries/profile";
import type { MemoryEvent } from "@/db/schema";
import {
  FOUNDER_FIELDS,
  FounderProfileSchema,
  MAX_ITEMS_PER_FIELD,
  MAX_ITEM_LENGTH,
  type FounderFieldKey,
  type FounderProfile,
} from "@/lib/profile";

export function readFounder(db: Db): { name: string | null; profile: FounderProfile } {
  const row = getOrCreateFounder(db);
  let profile: FounderProfile = {};
  try {
    const parsed = FounderProfileSchema.safeParse(JSON.parse(row.profile));
    if (parsed.success) profile = parsed.data;
  } catch {
    /* corrupt JSON: treat as empty rather than failing every chat */
  }
  return { name: row.name, profile };
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").replace(/[.\s]+$/, "").trim();

function isDuplicate(existing: string[], value: string): boolean {
  const v = norm(value);
  return existing.some((e) => {
    const n = norm(e);
    return n === v || (Math.min(n.length, v.length) >= 4 && (n.includes(v) || v.includes(n)));
  });
}

/** What the agent proposes to remember about the founder. `evidence` must be quoted from their message. */
export interface FounderCandidate {
  field: FounderFieldKey | "name";
  value: string;
  evidence: string;
}

export interface Origin {
  conversationId: string;
  messageId?: string;
}

export const MAX_UPDATES_PER_TURN = 5;

/**
 * Saves new facts about the founder. Low-risk, so applied automatically, but every change is recorded
 * with its source quote so it is visible and undoable.
 */
export function applyFounderCandidates(db: Db, candidates: FounderCandidate[], origin: Origin): MemoryEvent[] {
  const founder = getOrCreateFounder(db);
  const current = readFounder(db);
  const profile: FounderProfile = { ...current.profile };
  let name = current.name;
  const events: MemoryEvent[] = [];

  for (const c of candidates.slice(0, MAX_UPDATES_PER_TURN)) {
    const value = c.value.replace(/\s+/g, " ").trim().slice(0, MAX_ITEM_LENGTH);
    if (!value) continue;

    if (c.field === "name") {
      if (name) continue; // never overwrite a name the founder already set
      name = value.slice(0, 80);
      events.push(
        insertEvent(db, {
          entityType: "founder",
          entityId: founder.id,
          action: "update",
          actor: "agent",
          summary: `Name: ${name}`,
          reason: c.evidence,
          change: { field: "name", added: name },
          origin,
        }),
      );
      continue;
    }

    const list = profile[c.field] ?? [];
    if (list.length >= MAX_ITEMS_PER_FIELD || isDuplicate(list, value)) continue;
    profile[c.field] = [...list, value];
    const label = FOUNDER_FIELDS.find((f) => f.key === c.field)?.label ?? c.field;
    events.push(
      insertEvent(db, {
        entityType: "founder",
        entityId: founder.id,
        action: "update",
        actor: "agent",
        summary: `${label}: ${value}`,
        reason: c.evidence,
        change: { field: c.field, added: value },
        origin,
      }),
    );
  }

  if (events.length) saveFounder(db, { name, profile: JSON.stringify(profile) });
  return events;
}

/** Founder edits their own profile. Replaces the given fields and records what changed. */
export function saveFounderEdit(db: Db, patch: { name?: string | null; profile?: FounderProfile }): void {
  const founder = getOrCreateFounder(db);
  const current = readFounder(db);
  const next: FounderProfile = { ...current.profile };
  const changed: string[] = [];

  for (const [key, items] of Object.entries(patch.profile ?? {})) {
    const clean = (items ?? []).map((i) => i.trim()).filter(Boolean);
    if (JSON.stringify(clean) !== JSON.stringify(current.profile[key as FounderFieldKey] ?? [])) {
      next[key as FounderFieldKey] = clean;
      changed.push(FOUNDER_FIELDS.find((f) => f.key === key)?.label ?? key);
    }
  }
  const name = patch.name === undefined ? current.name : patch.name?.trim() || null;
  if (name !== current.name) changed.push("Name");
  if (!changed.length) return;

  saveFounder(db, { name, profile: JSON.stringify(next) });
  insertEvent(db, {
    entityType: "founder",
    entityId: founder.id,
    action: "update",
    actor: "user",
    summary: `Edited: ${changed.join(", ")}`,
    reason: "Edited directly by you",
  });
}

export type UndoResult = "undone" | "already_undone" | "not_found" | "unsupported";

/** Reverts an agent-added founder fact (removes just that item; later edits are untouched). */
export function undoFounderEvent(db: Db, eventId: string): UndoResult {
  const ev = getEvent(db, eventId);
  if (!ev) return "not_found";
  if (ev.undoneAt) return "already_undone";
  const change = JSON.parse(ev.change) as { field?: string; added?: string };
  if (ev.entityType !== "founder" || ev.actor !== "agent" || !change.field || !change.added) return "unsupported";

  const current = readFounder(db);
  if (change.field === "name") {
    if (current.name === change.added) saveFounder(db, { name: null });
  } else {
    const key = change.field as FounderFieldKey;
    const next = (current.profile[key] ?? []).filter((i) => i !== change.added);
    saveFounder(db, { profile: JSON.stringify({ ...current.profile, [key]: next }) });
  }
  markEventUndone(db, eventId);
  return "undone";
}
