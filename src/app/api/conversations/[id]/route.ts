import { z } from "zod";
import { getDb } from "@/db/client";
import {
  deleteConversation,
  getConversation,
  listMessages,
  renameConversation,
} from "@/db/queries/conversations";
import { rejectCrossOrigin } from "@/lib/security";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const Id = z.uuid();
const notFound = () => Response.json({ error: "Not found" }, { status: 404 });

export async function GET(_req: Request, { params }: Ctx) {
  const id = Id.safeParse((await params).id);
  if (!id.success) return notFound();
  const db = getDb();
  const conversation = getConversation(db, id.data);
  if (!conversation) return notFound();
  return Response.json({ conversation, messages: listMessages(db, id.data) });
}

export async function PATCH(req: Request, { params }: Ctx) {
  const blocked = rejectCrossOrigin(req);
  if (blocked) return blocked;
  const id = Id.safeParse((await params).id);
  const body = z.object({ title: z.string().trim().min(1).max(100) }).safeParse(await req.json().catch(() => null));
  if (!id.success || !body.success) return Response.json({ error: "Invalid request" }, { status: 400 });
  return renameConversation(getDb(), id.data, body.data.title) ? Response.json({ ok: true }) : notFound();
}

export async function DELETE(req: Request, { params }: Ctx) {
  const blocked = rejectCrossOrigin(req);
  if (blocked) return blocked;
  const id = Id.safeParse((await params).id);
  if (!id.success) return notFound();
  return deleteConversation(getDb(), id.data) ? Response.json({ ok: true }) : notFound();
}
