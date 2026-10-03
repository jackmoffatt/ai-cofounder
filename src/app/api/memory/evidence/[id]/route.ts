import { z } from "zod";
import { getDb } from "@/db/client";
import { rejectCrossOrigin } from "@/lib/security";
import { removeEvidence } from "@/services/memory/items";

export const dynamic = "force-dynamic";

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const blocked = rejectCrossOrigin(req);
  if (blocked) return blocked;
  const id = z.uuid().safeParse((await params).id);
  return id.success && removeEvidence(getDb(), id.data)
    ? Response.json({ ok: true })
    : Response.json({ error: "Not found" }, { status: 404 });
}
