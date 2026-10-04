import { getDb } from "@/db/client";
import { workOverview } from "@/services/work/view";

export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(workOverview(getDb()));
}
