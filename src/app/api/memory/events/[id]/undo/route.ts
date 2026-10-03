import { z } from "zod";
import { getDb } from "@/db/client";
import { rejectCrossOrigin } from "@/lib/security";
import { undoFounderEvent } from "@/services/memory/founder";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const blocked = rejectCrossOrigin(req);
  if (blocked) return blocked;
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) return Response.json({ error: "Not found" }, { status: 404 });
  const result = undoFounderEvent(getDb(), id.data);
  if (result === "not_found") return Response.json({ error: "Not found" }, { status: 404 });
  if (result === "unsupported") return Response.json({ error: "This change can't be undone" }, { status: 409 });
  return Response.json({ ok: true, result });
}
