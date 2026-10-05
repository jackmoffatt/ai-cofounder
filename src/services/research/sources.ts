import type { Db } from "@/db/client";
import { listSourcesForItem } from "@/db/queries/research";

/** "acme.com, b.com, 2026-10-05": where a research finding came from and when it was last read. */
export function sourcesNote(db: Db, itemId: string): string {
  const links = listSourcesForItem(db, itemId);
  if (!links.length) return "";
  const domains = [...new Set(links.map((l) => l.publisher))].join(", ");
  return `${domains}, ${links.map((l) => l.fetchedAt.slice(0, 10)).sort().at(-1)}`;
}
