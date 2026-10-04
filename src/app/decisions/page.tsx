import { DecisionsPage } from "@/components/work/DecisionsPage";
import { getDb } from "@/db/client";
import { listItemViews } from "@/services/memory/view";

export const dynamic = "force-dynamic";
export const metadata = { title: "Decisions · AI Co-Founder" };

export default async function Page({ searchParams }: { searchParams: Promise<{ item?: string }> }) {
  const { item } = await searchParams;
  return <DecisionsPage initialItems={listItemViews(getDb(), "decision")} initialItemId={item ?? null} />;
}
