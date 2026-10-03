import type { Db } from "@/db/client";
import { getItem, listEvidence } from "@/db/queries/memory";
import type { MemoryEvent, Proposal } from "@/db/schema";
import type { ItemKind } from "@/lib/memory";
import { STAGE_KEYS, STARTUP_FIELDS, type StageKey, type StartupFieldKey } from "@/lib/profile";
import { applyFounderCandidates, type Origin } from "./founder";
import { addEvidence, createItem, findDuplicate } from "./items";
import { createProposal, type ProposalChange } from "./proposals";
import { readActiveStartup } from "./startup";

/** Shape of validated model output (see agent/extraction.ts). Kept structural to avoid a dependency cycle. */
export interface Candidates {
  founder: Array<{ field: Parameters<typeof applyFounderCandidates>[1][number]["field"]; value: string; quote: string }>;
  items: Array<{ kind: Exclude<ItemKind, "note">; title: string; details: string; importance: number; quote: string }>;
  evidence: Array<{ target: string; stance: "supports" | "weakens"; strength: "anecdotal" | "moderate"; excerpt: string; quote: string }>;
  proposals: Array<{
    type: ProposalChange["type"];
    field: string | null;
    value: string | null;
    target: string | null;
    rationale: string;
    quote: string;
  }>;
}

export const MAX_ITEMS_PER_TURN = 5;
export const MAX_EVIDENCE_PER_TURN = 4;
export const MAX_PROPOSALS_PER_TURN = 2;

export interface IngestResult {
  events: MemoryEvent[];
  proposals: Proposal[];
}

/**
 * The write policy. Everything the model suggested is re-checked here, and only low-risk memory is
 * written directly:
 *  - new items always start at the kind's default status (assumptions: untested, low confidence)
 *  - evidence can only move an assumption through derived statuses, never to validated/rejected
 *  - anything that changes the startup's direction becomes a pending proposal
 */
export function ingestCandidates(
  db: Db,
  c: Candidates,
  codes: Map<string, { id: string }>,
  origin: Origin,
): IngestResult {
  const startup = readActiveStartup(db);
  const events: MemoryEvent[] = [];
  const proposals: Proposal[] = [];

  events.push(
    ...applyFounderCandidates(
      db,
      c.founder.map((f) => ({ field: f.field, value: f.value, evidence: f.quote })),
      origin,
    ),
  );

  for (const it of c.items.slice(0, MAX_ITEMS_PER_TURN)) {
    if (findDuplicate(db, it.kind, it.title)) continue;
    const { event } = createItem(db, {
      kind: it.kind,
      title: it.title,
      body: it.details,
      importance: it.importance,
      data:
        it.kind === "decision"
          ? { reasoning: it.details }
          : it.kind === "insight"
            ? { source: "founder-reported", observationCount: 1 }
            : {},
      origin: "conversation",
      originRef: { ...origin, quote: it.quote },
      createdBy: "agent",
      startupId: startup?.id ?? null,
      reason: it.quote,
    });
    events.push(event);
  }

  let evidenceCount = 0;
  for (const ev of c.evidence) {
    if (evidenceCount >= MAX_EVIDENCE_PER_TURN) break;
    const itemId = codes.get(ev.target)?.id;
    if (!itemId) continue;
    const item = getItem(db, itemId);
    if (!item || item.deletedAt || item.kind !== "assumption") continue;
    if (listEvidence(db, itemId).some((e) => e.excerpt.toLowerCase() === ev.excerpt.trim().toLowerCase())) continue;
    const { event } = addEvidence(db, {
      itemId,
      stance: ev.stance,
      strength: ev.strength,
      excerpt: ev.excerpt,
      origin: "conversation",
      originRef: { ...origin, quote: ev.quote },
      createdBy: "agent",
    });
    events.push(event);
    evidenceCount++;
  }

  for (const p of c.proposals) {
    if (proposals.length >= MAX_PROPOSALS_PER_TURN) break;
    const change = toChange(p, codes);
    if (!change) continue;
    const row = createProposal(db, change, { rationale: p.rationale || p.quote, originRef: { ...origin, quote: p.quote } });
    if (row) proposals.push(row);
  }

  return { events, proposals };
}

function toChange(p: Candidates["proposals"][number], codes: Map<string, { id: string }>): ProposalChange | null {
  const value = p.value?.trim() ?? "";
  const itemId = p.target ? codes.get(p.target)?.id : undefined;
  switch (p.type) {
    case "startup_field": {
      const field = STARTUP_FIELDS.find((f) => f.key === p.field)?.key as StartupFieldKey | undefined;
      return field && value ? { type: "startup_field", field, value } : null;
    }
    case "stage":
      return STAGE_KEYS.includes(value as StageKey) ? { type: "stage", to: value as StageKey } : null;
    case "objective":
      return value ? { type: "objective", text: value } : null;
    case "assumption_status":
      return itemId && (value === "validated" || value === "rejected")
        ? { type: "assumption_status", itemId, to: value }
        : null;
    case "decision_supersede":
      return itemId && value ? { type: "decision_supersede", itemId, title: value, reasoning: p.rationale } : null;
  }
}
