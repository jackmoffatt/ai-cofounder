import type { Db } from "@/db/client";
import { getCompetitorRow, insertCompetitorRow, listCompetitorRows, updateCompetitorRow } from "@/db/queries/research";
import { insertEvent } from "@/db/queries/profile";
import { LOCAL_OWNER, type Competitor } from "@/db/schema";
import { readActiveStartup } from "@/services/memory/startup";
import type { CompetitorField, ValidCompetitor } from "./synthesize";

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, "").replace(/\s+/g, " ").trim();

export type FieldSources = Partial<Record<CompetitorField, Array<{ sourceId: string; quote: string }>>>;

export const parseFieldSources = (c: Competitor): FieldSources => {
  try {
    return JSON.parse(c.fieldSources) as FieldSources;
  } catch {
    return {};
  }
};

/**
 * Creates or refreshes a competitor from verified fields. Newer research replaces a field's value and
 * its sources, so each value always points at the evidence it came from.
 */
export function upsertCompetitor(db: Db, v: ValidCompetitor, now = new Date().toISOString()): { competitor: Competitor; updated: CompetitorField[] } {
  const existing = listCompetitorRows(db).find((c) => norm(c.company) === norm(v.company));
  const row: Competitor =
    existing ?? {
      id: crypto.randomUUID(),
      ownerId: LOCAL_OWNER,
      startupId: readActiveStartup(db)?.id ?? null,
      company: v.company,
      product: "",
      targetCustomer: "",
      valueProposition: "",
      pricing: "",
      businessModel: "",
      strengths: "",
      weaknesses: "",
      fieldSources: "{}",
      lastResearched: now,
      createdAt: now,
    };

  const sources = parseFieldSources(row);
  const patch: Partial<Competitor> = {};
  const updated: CompetitorField[] = [];
  for (const f of v.fields) {
    // Several facts for one field (e.g. two pricing tiers) are joined, each with its own source.
    const already = updated.includes(f.field);
    const current = already ? String(patch[f.field] ?? "") : "";
    patch[f.field] = current ? `${current}; ${f.value}` : f.value;
    sources[f.field] = already ? [...(sources[f.field] ?? []), { sourceId: f.sourceId, quote: f.quote }] : [{ sourceId: f.sourceId, quote: f.quote }];
    if (!already) updated.push(f.field);
  }
  const next: Competitor = { ...row, ...patch, fieldSources: JSON.stringify(sources), lastResearched: now };
  if (existing) updateCompetitorRow(db, row.id, { ...patch, fieldSources: next.fieldSources, lastResearched: now });
  else insertCompetitorRow(db, next);

  insertEvent(db, {
    entityType: "competitor",
    entityId: row.id,
    action: existing ? "update" : "create",
    actor: "agent",
    summary: `${existing ? "Updated" : "Added"} competitor: ${v.company} (${updated.join(", ")})`,
    reason: "From web research",
  });
  return { competitor: getCompetitorRow(db, row.id)!, updated };
}
