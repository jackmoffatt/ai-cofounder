import { MemoryPage } from "@/components/memory/MemoryPage";
import { getDb } from "@/db/client";
import { listProposalRows } from "@/services/memory/proposals";
import { listItemViews, toCard } from "@/services/memory/view";

export const dynamic = "force-dynamic";
export const metadata = { title: "Memory · AI Co-Founder" };

export default async function Page({ searchParams }: { searchParams: Promise<{ item?: string }> }) {
  const { item } = await searchParams;
  const db = getDb();
  return (
    <MemoryPage
      initialItems={listItemViews(db)}
      initialProposals={listProposalRows(db, "pending").map(toCard)}
      initialItemId={item ?? null}
    />
  );
}
