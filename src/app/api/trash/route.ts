import { z } from "zod";
import { getDb } from "@/db/client";
import { rejectCrossOrigin } from "@/lib/security";
import { listTrash, purgeFromTrash, restoreFromTrash } from "@/services/trash";

export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({ entries: listTrash(getDb()) });
}

const Body = z.object({ action: z.enum(["restore", "purge"]), type: z.enum(["item", "task"]), id: z.uuid() });

export async function POST(req: Request) {
  const blocked = rejectCrossOrigin(req);
  if (blocked) return blocked;
  const body = Body.safeParse(await req.json().catch(() => null));
  if (!body.success) return Response.json({ error: "Invalid request" }, { status: 400 });
  const db = getDb();
  const done = body.data.action === "restore" ? restoreFromTrash(db, body.data.type, body.data.id) : purgeFromTrash(db, body.data.type, body.data.id);
  return done ? Response.json({ ok: true }) : Response.json({ error: "Not found" }, { status: 404 });
}
