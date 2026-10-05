import type { Db } from "@/db/client";
import { getConversation } from "@/db/queries/conversations";
import { getItem, listEventsForEntity, listEvidence, listItems } from "@/db/queries/memory";
import { listCompetitorRows, listSourcesForItem, getSourceRow, type SourceLink } from "@/db/queries/research";
import { parseFieldSources } from "@/services/research/competitors";
import type { Competitor } from "@/db/schema";
import type { Evidence, MemoryEvent, MemoryItem } from "@/db/schema";
import { refFor } from "@/lib/memory";
import type { PlanChange } from "@/services/work/plan";

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
  /** Web sources behind a research finding, with the quote that supports it. */
  sources: SourceLink[];
  /** For research findings: the question that was researched. */
  researchQuestion: string | null;
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
    sources: item.kind === "research" ? listSourcesForItem(db, id) : [],
    researchQuestion: item.kind === "research" ? String((parse(item.data) as { question?: string }).question ?? "") || null : null,
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
  /** The full plan, for plan proposals, so the card can show what accepting would create. */
  plan?: PlanChange;
}

export const toCard = (p: { id: string; type: string; summary: string; rationale: string; status: ProposalCard["status"]; change?: string }): ProposalCard => {
  let plan: PlanChange | undefined;
  if (p.type === "plan" && p.change) {
    try {
      plan = JSON.parse(p.change) as PlanChange;
    } catch {
      /* show the summary only */
    }
  }
  return { id: p.id, type: p.type, summary: p.summary, rationale: p.rationale, status: p.status, ...(plan ? { plan } : {}) };
};

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

export interface ResearchFindingView extends ItemView {
  question: string;
  implication: string;
  sources: Array<{ publisher: string; url: string; title: string; fetchedAt: string }>;
}

export interface CompetitorView {
  id: string;
  company: string;
  fields: Array<{ key: string; label: string; value: string; sources: Array<{ url: string; publisher: string; quote: string; fetchedAt: string }> }>;
  lastResearched: string;
}

export interface ResearchOverview {
  findings: ResearchFindingView[];
  competitors: CompetitorView[];
}

const COMPETITOR_LABELS: Array<[keyof Competitor, string]> = [
  ["product", "Product"],
  ["targetCustomer", "Target customer"],
  ["valueProposition", "Value proposition"],
  ["pricing", "Pricing"],
  ["businessModel", "Business model"],
  ["strengths", "Strengths"],
  ["weaknesses", "Weaknesses"],
];

export function researchOverview(db: Db): ResearchOverview {
  const findings = listItems(db, { kind: "research" }).map((i): ResearchFindingView => {
    const data = parse(i.data) as { question?: string; implication?: string };
    return {
      ...toItemView(db, i),
      question: data.question ?? "Other",
      implication: data.implication ?? i.body,
      sources: listSourcesForItem(db, i.id).map((s) => ({ publisher: s.publisher, url: s.url, title: s.title, fetchedAt: s.fetchedAt })),
    };
  });
  const competitors = listCompetitorRows(db).map((c): CompetitorView => {
    const fs = parseFieldSources(c);
    return {
      id: c.id,
      company: c.company,
      lastResearched: c.lastResearched,
      fields: COMPETITOR_LABELS.flatMap(([key, label]) =>
        c[key]
          ? [
              {
                key,
                label,
                value: String(c[key]),
                sources: (fs[key as keyof typeof fs] ?? []).flatMap((s) => {
                  const src = getSourceRow(db, s.sourceId);
                  return src ? [{ url: src.url, publisher: src.publisher, quote: s.quote, fetchedAt: src.fetchedAt }] : [];
                }),
              },
            ]
          : [],
      ),
    };
  });
  return { findings, competitors };
}
