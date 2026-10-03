import { z } from "zod";
import { getDb } from "@/db/client";
import { rejectCrossOrigin } from "@/lib/security";
import { MemoryError, addEvidence } from "@/services/memory/items";
import { getItemDetail } from "@/services/memory/view";

export const dynamic = "force-dynamic";

const Body = z.object({
  stance: z.enum(["supports", "weakens"]),
  strength: z.enum(["anecdotal", "moderate", "strong"]),
  excerpt: z.string().trim().min(1).max(1000),
});

/** Evidence the founder adds by hand, e.g. from an interview. May be rated "strong". */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const blocked = rejectCrossOrigin(req);
  if (blocked) return blocked;
  const id = z.uuid().safeParse((await params).id);
  const body = Body.safeParse(await req.json().catch(() => null));
  if (!id.success || !body.success) return Response.json({ error: "Invalid request" }, { status: 400 });
  const db = getDb();
  try {
    addEvidence(db, { itemId: id.data, ...body.data, origin: "manual", createdBy: "user" });
  } catch (e) {
    if (e instanceof MemoryError) return Response.json({ error: "Not found" }, { status: 404 });
    throw e;
  }
  return Response.json({ item: getItemDetail(db, id.data) }, { status: 201 });
}
