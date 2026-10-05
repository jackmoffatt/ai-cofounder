import type { Db } from "@/db/client";
import { getItem, listEvidence, listItems, searchItemIds } from "@/db/queries/memory";
import { sourcesNote } from "@/services/research/sources";
import type { MemoryItem } from "@/db/schema";
import { INACTIVE_STATUSES, type ItemKind } from "@/lib/memory";
import type { Mode } from "@/lib/modes";
import { toFtsQuery } from "@/db/queries/conversations";
import type { Intent } from "./intent";

export type Reason = "recipe" | "keyword" | "recent";

export interface Retrieved {
  item: MemoryItem;
  reason: Reason;
  score: number;
  evidenceCount: number;
  /** For research findings: where it came from, e.g. "acme.com, 2026-10-05". */
  sourceNote?: string;
}

interface Slot {
  kind: ItemKind;
  /** Only items in these statuses; omit for all live statuses. */
  statuses?: readonly string[];
  cap: number;
}

const OPEN_ASSUMPTIONS = ["untested", "testing", "weakened", "supported"] as const;

/**
 * What each mode usually needs. This is deliberately a table, not an algorithm: the model reasons from
 * whatever lands in context. Keyword matches are added on top of this.
 */
const RECIPES: Record<Mode, Slot[]> = {
  DISCOVER: [
    { kind: "idea", cap: 6 },
    { kind: "insight", cap: 5 },
    { kind: "question", cap: 4 },
    { kind: "assumption", statuses: OPEN_ASSUMPTIONS, cap: 3 },
  ],
  RESEARCH: [
    { kind: "question", cap: 6 },
    { kind: "assumption", statuses: OPEN_ASSUMPTIONS, cap: 6 },
    { kind: "insight", cap: 4 },
    { kind: "research", cap: 8 },
  ],
  STRATEGY: [
    { kind: "decision", cap: 6 },
    { kind: "assumption", statuses: OPEN_ASSUMPTIONS, cap: 6 },
    { kind: "idea", cap: 3 },
    { kind: "insight", cap: 4 },
    { kind: "research", cap: 3 },
  ],
  VALIDATE: [
    { kind: "assumption", statuses: OPEN_ASSUMPTIONS, cap: 8 },
    { kind: "insight", cap: 5 },
    { kind: "question", cap: 4 },
    { kind: "decision", cap: 2 },
    { kind: "research", cap: 3 },
  ],
  PRODUCT: [
    { kind: "decision", cap: 5 },
    { kind: "assumption", statuses: OPEN_ASSUMPTIONS, cap: 5 },
    { kind: "insight", cap: 5 },
    { kind: "idea", cap: 3 },
    { kind: "research", cap: 3 },
  ],
  BUILD: [
    { kind: "decision", cap: 6 },
    { kind: "assumption", statuses: ["untested", "testing", "weakened"], cap: 4 },
    { kind: "question", cap: 3 },
  ],
  GROW: [
    { kind: "insight", cap: 5 },
    { kind: "assumption", statuses: OPEN_ASSUMPTIONS, cap: 5 },
    { kind: "decision", cap: 4 },
    { kind: "question", cap: 3 },
    { kind: "research", cap: 3 },
  ],
  REVIEW: [
    { kind: "decision", cap: 5 },
    { kind: "assumption", statuses: OPEN_ASSUMPTIONS, cap: 6 },
    { kind: "question", cap: 5 },
    { kind: "insight", cap: 3 },
    { kind: "idea", cap: 3 },
    { kind: "research", cap: 2 },
  ],
};

export const MAX_RETRIEVED = 24;
const KEYWORD_LIMIT = 10;

const live = (i: MemoryItem) => !i.deletedAt && !INACTIVE_STATUSES.has(i.status) && i.kind !== "note";
const recency = (i: MemoryItem) => Math.max(0, 1 - (Date.now() - new Date(i.updatedAt).getTime()) / (1000 * 60 * 60 * 24 * 60)); // 0..1 over ~60 days
const baseScore = (i: MemoryItem) => i.importance * 2 + recency(i) * 2;

/**
 * Picks the stored knowledge worth showing for this message: the mode's recipe, plus anything matching
 * the message's keywords (any kind, even closed items, since "why did we decide X" needs old decisions).
 */
export function retrieve(db: Db, intent: Intent, limit = MAX_RETRIEVED): Retrieved[] {
  const all = listItems(db);
  const picked = new Map<string, Retrieved>();
  const evCount = (id: string) => listEvidence(db, id).length;
  const add = (item: MemoryItem, reason: Reason, score: number) => {
    const existing = picked.get(item.id);
    if (existing && existing.score >= score) return;
    const sourceNote = item.kind === "research" ? sourcesNote(db, item.id) : undefined;
    picked.set(item.id, { item, reason: existing?.reason === "keyword" ? "keyword" : reason, score, evidenceCount: evCount(item.id), sourceNote });
  };

  const slots = [...RECIPES[intent.mode]];
  for (const kind of intent.kinds) if (!slots.some((s) => s.kind === kind)) slots.push({ kind, cap: 4 });
  for (const slot of slots) {
    all
      .filter((i) => i.kind === slot.kind && live(i) && (!slot.statuses || slot.statuses.includes(i.status)))
      .sort((a, b) => baseScore(b) - baseScore(a))
      .slice(0, slot.cap)
      .forEach((i) => add(i, "recipe", baseScore(i)));
  }

  const fts = toFtsQuery(intent.keywords.join(" "), "or");
  if (fts) {
    searchItemIds(db, fts, KEYWORD_LIMIT).forEach((id, rank) => {
      const item = getItem(db, id);
      if (item && !item.deletedAt && item.kind !== "note") add(item, "keyword", 100 - rank);
    });
  }

  return [...picked.values()].sort((a, b) => b.score - a.score).slice(0, limit);
}

