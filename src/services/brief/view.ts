import type { Db } from "@/db/client";
import { getTraceForMessage, latestBrief, listBriefs } from "@/db/queries/context";
import { getProposalRows } from "@/db/queries/memory";
import { getEvents } from "@/db/queries/profile";
import type { StartupBrief } from "@/db/schema";
import type { ContextTrace } from "@/agent/contextBuilder";
import { resolveRefs } from "@/services/memory/view";
import { briefStatus, readNextAction, type NextAction } from "./index";

export interface BriefView {
  version: number;
  content: string;
  createdAt: string;
  reason: string;
  nextAction: NextAction | null;
  refs: Record<string, { id: string; kind: string; title: string }>;
}

export interface BriefOverview {
  brief: BriefView | null;
  versions: Array<{ version: number; createdAt: string; reason: string }>;
  stale: boolean;
}

export function toBriefView(db: Db, b: StartupBrief): BriefView {
  return { version: b.version, content: b.content, createdAt: b.createdAt, reason: b.reason, nextAction: readNextAction(b), refs: resolveRefs(db, b.content) };
}

export function briefOverview(db: Db): BriefOverview {
  const latest = latestBrief(db);
  return {
    brief: latest ? toBriefView(db, latest) : null,
    versions: listBriefs(db).map((b) => ({ version: b.version, createdAt: b.createdAt, reason: b.reason })),
    stale: briefStatus(db).stale,
  };
}

export function briefVersion(db: Db, version: number): BriefView | null {
  const row = listBriefs(db, 100).find((b) => b.version === version);
  return row ? toBriefView(db, row) : null;
}

export interface TraceView {
  mode: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
  createdAt: string;
  context: ContextTrace;
  memoryChanges: string[];
  proposals: string[];
}

export function traceViewForMessage(db: Db, messageId: string): TraceView | null {
  const t = getTraceForMessage(db, messageId);
  if (!t) return null;
  const out = JSON.parse(t.outputs) as { memoryEventIds?: string[]; proposalIds?: string[] };
  return {
    mode: t.mode,
    model: t.model,
    tokensIn: t.tokensIn,
    tokensOut: t.tokensOut,
    latencyMs: t.latencyMs,
    createdAt: t.createdAt,
    context: JSON.parse(t.context) as ContextTrace,
    memoryChanges: getEvents(db, out.memoryEventIds ?? []).map((e) => e.summary),
    proposals: getProposalRows(db, out.proposalIds ?? []).map((p) => p.summary),
  };
}
