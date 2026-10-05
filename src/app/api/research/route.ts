import { getDb } from "@/db/client";
import { researchOverview } from "@/services/memory/view";

export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(researchOverview(getDb()));
}
