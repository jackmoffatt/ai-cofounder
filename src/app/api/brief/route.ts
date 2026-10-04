import { z } from "zod";
import { getDb } from "@/db/client";
import { rejectCrossOrigin } from "@/lib/security";
import { getProvider } from "@/services/ai";
import { generateBrief, hasBriefContent } from "@/services/brief";
import { briefOverview, briefVersion, toBriefView } from "@/services/brief/view";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export function GET(req: Request) {
  const db = getDb();
  const v = z.coerce.number().int().positive().safeParse(new URL(req.url).searchParams.get("version"));
  if (v.success) {
    const brief = briefVersion(db, v.data);
    return brief ? Response.json({ brief }) : Response.json({ error: "Not found" }, { status: 404 });
  }
  return Response.json(briefOverview(db));
}

/** Regenerate the brief now. */
export async function POST(req: Request) {
  const blocked = rejectCrossOrigin(req);
  if (blocked) return blocked;
  const db = getDb();
  if (!hasBriefContent(db)) return Response.json({ error: "There's nothing to summarise yet." }, { status: 409 });
  const row = await generateBrief(db, getProvider(), "manual");
  if (!row) return Response.json({ error: "Couldn't write the brief right now. Try again shortly." }, { status: 502 });
  return Response.json({ ...briefOverview(db), brief: toBriefView(db, row) });
}
