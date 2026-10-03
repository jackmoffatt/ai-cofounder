import { z } from "zod";
import { getDb } from "@/db/client";
import { CONFIDENCES } from "@/lib/memory";
import { rejectCrossOrigin } from "@/lib/security";
import { MemoryError, deleteItem, updateItem } from "@/services/memory/items";
import { getItemDetail } from "@/services/memory/view";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };
const notFound = () => Response.json({ error: "Not found" }, { status: 404 });

export async function GET(_req: Request, { params }: Ctx) {
  const id = z.uuid().safeParse((await params).id);
  const detail = id.success ? getItemDetail(getDb(), id.data) : null;
  return detail ? Response.json({ item: detail }) : notFound();
}

const Patch = z.object({
  title: z.string().trim().min(1).max(300).optional(),
  body: z.string().max(4000).optional(),
  status: z.string().max(40).optional(),
  confidence: z.enum(CONFIDENCES).optional(),
  importance: z.number().int().min(1).max(5).optional(),
});

export async function PATCH(req: Request, { params }: Ctx) {
  const blocked = rejectCrossOrigin(req);
  if (blocked) return blocked;
  const id = z.uuid().safeParse((await params).id);
  const body = Patch.safeParse(await req.json().catch(() => null));
  if (!id.success || !body.success) return Response.json({ error: "Invalid request" }, { status: 400 });
  const db = getDb();
  try {
    updateItem(db, id.data, body.data);
  } catch (e) {
    if (e instanceof MemoryError) return e.message === "Not found" ? notFound() : Response.json({ error: e.message }, { status: 400 });
    throw e;
  }
  return Response.json({ item: getItemDetail(db, id.data) });
}

export async function DELETE(req: Request, { params }: Ctx) {
  const blocked = rejectCrossOrigin(req);
  if (blocked) return blocked;
  const id = z.uuid().safeParse((await params).id);
  return id.success && deleteItem(getDb(), id.data) ? Response.json({ ok: true }) : notFound();
}
