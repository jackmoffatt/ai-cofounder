import { getDb } from "@/db/client";
import { rejectCrossOrigin } from "@/lib/security";
import { exportAll } from "@/services/dataExport";

export const dynamic = "force-dynamic";

/** Everything the app holds, as one JSON file the founder can keep. */
export function GET(req: Request) {
  const blocked = rejectCrossOrigin(req);
  if (blocked) return blocked;
  const file = exportAll(getDb());
  return new Response(JSON.stringify(file, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="cofounder-export-${file.exportedAt.slice(0, 10)}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
