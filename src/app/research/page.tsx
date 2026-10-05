import { ResearchPage } from "@/components/research/ResearchPage";
import { getDb } from "@/db/client";
import { researchOverview } from "@/services/memory/view";

export const dynamic = "force-dynamic";
export const metadata = { title: "Research · AI Co-Founder" };

export default function Page() {
  return <ResearchPage initial={researchOverview(getDb())} />;
}
