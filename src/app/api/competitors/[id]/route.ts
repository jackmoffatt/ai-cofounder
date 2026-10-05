import { z } from "zod";
import { getDb } from "@/db/client";
import { deleteCompetitorRow, getCompetitorRow } from "@/db/queries/research";
import { insertEvent } from "@/db/queries/profile";
import { rejectCrossOrigin } from "@/lib/security";

export const dynamic = "force-dynamic";

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const blocked = rejectCrossOrigin(req);
  if (blocked) return blocked;
  const id = z.uuid().safeParse((await params).id);
  const db = getDb();
  const row = id.success ? getCompetitorRow(db, id.data) : undefined;
  if (!row) return Response.json({ error: "Not found" }, { status: 404 });
  deleteCompetitorRow(db, row.id);
  insertEvent(db, { entityType: "competitor", entityId: row.id, action: "delete", actor: "user", summary: `Deleted competitor: ${row.company}`, reason: "Deleted by you" });
  return Response.json({ ok: true });
}
