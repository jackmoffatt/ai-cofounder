import { getDb } from "@/db/client";
import { healthReport } from "@/services/health";

export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(healthReport(getDb()));
}
