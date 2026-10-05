import { z } from "zod";
import { getDb } from "@/db/client";
import { getItem } from "@/db/queries/memory";
import { listSourcesForItem } from "@/db/queries/research";
import { domainErrorResponse } from "@/lib/apiErrors";
import { rejectCrossOrigin } from "@/lib/security";
import { addEvidence } from "@/services/memory/items";
import { getItemDetail } from "@/services/memory/view";

export const dynamic = "force-dynamic";

const Body = z.object({
  assumptionId: z.uuid(),
  stance: z.enum(["supports", "weakens"]),
  // Web research is at most "moderate": only your own firsthand evidence can be "strong".
  strength: z.enum(["anecdotal", "moderate"]),
});

/** The founder judges that a research finding bears on an assumption, and attaches it as evidence. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const blocked = rejectCrossOrigin(req);
  if (blocked) return blocked;
  const id = z.uuid().safeParse((await params).id);
  const body = Body.safeParse(await req.json().catch(() => null));
  if (!id.success || !body.success) return Response.json({ error: "Invalid request" }, { status: 400 });

  const db = getDb();
  const finding = getItem(db, id.data);
  const target = getItem(db, body.data.assumptionId);
  if (!finding || finding.deletedAt || finding.kind !== "research" || !target || target.deletedAt || target.kind !== "assumption") {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  const sources = listSourcesForItem(db, finding.id);
  try {
    addEvidence(db, {
      itemId: target.id,
      stance: body.data.stance,
      strength: body.data.strength,
      excerpt: `${finding.title} (${[...new Set(sources.map((s) => s.publisher))].join(", ") || "web research"})`,
      origin: "research",
      originRef: { researchItemId: finding.id, sourceIds: sources.map((s) => s.sourceId) },
      createdBy: "user",
    });
  } catch (e) {
    return domainErrorResponse(e);
  }
  return Response.json({ item: getItemDetail(db, target.id) }, { status: 201 });
}
