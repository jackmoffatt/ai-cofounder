import type { Db } from "@/db/client";
import { getConversation } from "@/db/queries/conversations";
import { getItem, listEventsForEntity, listEvidence, listItems } from "@/db/queries/memory";
import type { Evidence, MemoryEvent, MemoryItem } from "@/db/schema";
import { refFor } from "@/lib/memory";

/** JSON-friendly shapes for the UI (parsed JSON columns, no internal fields). */
export interface ItemView {
  id: string;
  kind: MemoryItem["kind"];
  title: string;
  body: string;
  status: string;
  confidence: MemoryItem["confidence"];
  importance: number;
  data: Record<string, unknown>;
  origin: MemoryItem["origin"];
  createdBy: MemoryItem["createdBy"];
  createdAt: string;
  updatedAt: string;
  evidenceCount: number;
}

export interface ItemDetail extends ItemView {
  evidence: Array<Pick<Evidence, "id" | "stance" | "strength" | "excerpt" | "origin" | "createdBy" | "createdAt">>;
  /** Where this came from: the saved quote and, for conversations, a link target. */
  provenance: { quote: string | null; conversationId: string | null; conversationTitle: string | null };
  history: Array<Pick<MemoryEvent, "id" | "summary" | "reason" | "actor" | "createdAt" | "undoneAt">>;
}

const parse = (json: string): Record<string, unknown> => {
  try {
    return JSON.parse(json);
  } catch {
    return {};
  }
};

export function toItemView(db: Db, item: MemoryItem): ItemView {
  return {
    id: item.id,
    kind: item.kind,
    title: item.title,
    body: item.body,
    status: item.status,
    confidence: item.confidence,
    importance: item.importance,
    data: parse(item.data),
    origin: item.origin,
    createdBy: item.createdBy,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    evidenceCount: listEvidence(db, item.id).length,
  };
}

export function listItemViews(db: Db, kind?: MemoryItem["kind"]): ItemView[] {
  return listItems(db, { kind }).map((i) => toItemView(db, i));
}

export function getItemDetail(db: Db, id: string): ItemDetail | null {
  const item = getItem(db, id);
  if (!item || item.deletedAt) return null;
  const ref = parse(item.originRef) as { conversationId?: string; quote?: string };
  const conv = ref.conversationId ? getConversation(db, ref.conversationId) : undefined;
  return {
    ...toItemView(db, item),
    evidence: listEvidence(db, id).map((e) => ({
      id: e.id,
      stance: e.stance,
      strength: e.strength,
      excerpt: e.excerpt,
      origin: e.origin,
      createdBy: e.createdBy,
      createdAt: e.createdAt,
    })),
    provenance: { quote: ref.quote ?? null, conversationId: conv?.id ?? null, conversationTitle: conv?.title ?? null },
    history: listEventsForEntity(db, "memory_item", id).map((e) => ({
      id: e.id,
      summary: e.summary,
      reason: e.reason,
      actor: e.actor,
      createdAt: e.createdAt,
      undoneAt: e.undoneAt,
    })),
  };
}

/** A change the agent suggests but only the founder can approve. */
export interface ProposalCard {
  id: string;
  type: string;
  summary: string;
  rationale: string;
  status: "pending" | "accepted" | "rejected";
}

export const toCard = (p: ProposalCard): ProposalCard => ({
  id: p.id,
  type: p.type,
  summary: p.summary,
  rationale: p.rationale,
  status: p.status,
});

/** Resolves [m:handle] citations in `text` to real items so the UI can link them. Unknown handles are omitted. */
export function resolveRefs(db: Db, text: string): Record<string, { id: string; kind: string; title: string }> {
  const handles = new Set([...text.matchAll(/\[m:([0-9a-f]{6,8})\]/g)].map((m) => m[1]));
  if (!handles.size) return {};
  const out: Record<string, { id: string; kind: string; title: string }> = {};
  for (const i of listItems(db)) {
    const h = refFor(i.id);
    if (handles.has(h)) out[h] = { id: i.id, kind: i.kind, title: i.title };
  }
  return out;
}
