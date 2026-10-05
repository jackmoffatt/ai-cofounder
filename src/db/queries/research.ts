import { and, desc, eq, gt, sql } from "drizzle-orm";
import type { Db } from "../client";
import { LOCAL_OWNER, competitors, researchSources, sources, type Competitor, type Source } from "../schema";

export const insertSourceRow = (db: Db, row: Source) => void db.insert(sources).values(row).run();
export const getSourceRow = (db: Db, id: string): Source | undefined => db.select().from(sources).where(eq(sources.id, id)).get();

/** A successfully fetched copy of this URL newer than `sinceIso`, to avoid refetching pages we just read. */
export function findFreshSource(db: Db, url: string, sinceIso: string): Source | undefined {
  return db
    .select()
    .from(sources)
    .where(and(eq(sources.url, url), eq(sources.ok, true), gt(sources.fetchedAt, sinceIso)))
    .orderBy(desc(sources.fetchedAt))
    .limit(1)
    .get();
}

export const linkSource = (db: Db, itemId: string, sourceId: string, quote: string) =>
  void db.insert(researchSources).values({ itemId, sourceId, quote }).onConflictDoNothing().run();

export interface SourceLink {
  sourceId: string;
  url: string;
  title: string;
  publisher: string;
  fetchedAt: string;
  quote: string;
}

export function listSourcesForItem(db: Db, itemId: string): SourceLink[] {
  return db
    .select({ sourceId: sources.id, url: sources.url, title: sources.title, publisher: sources.publisher, fetchedAt: sources.fetchedAt, quote: researchSources.quote })
    .from(researchSources)
    .innerJoin(sources, eq(researchSources.sourceId, sources.id))
    .where(eq(researchSources.itemId, itemId))
    .all();
}

export const listCompetitorRows = (db: Db): Competitor[] =>
  db.select().from(competitors).where(eq(competitors.ownerId, LOCAL_OWNER)).orderBy(desc(competitors.lastResearched)).all();
export const getCompetitorRow = (db: Db, id: string): Competitor | undefined => db.select().from(competitors).where(eq(competitors.id, id)).get();
export const insertCompetitorRow = (db: Db, row: Competitor) => void db.insert(competitors).values(row).run();
export const updateCompetitorRow = (db: Db, id: string, patch: Partial<Competitor>) => void db.update(competitors).set(patch).where(eq(competitors.id, id)).run();
export const deleteCompetitorRow = (db: Db, id: string) => void db.delete(competitors).where(eq(competitors.id, id)).run();
export const countSources = (db: Db): number => db.select({ n: sql<number>`count(*)` }).from(sources).get()!.n;
