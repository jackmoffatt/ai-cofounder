import { z } from "zod";
import { getDb } from "@/db/client";
import { domainErrorResponse } from "@/lib/apiErrors";
import { rejectCrossOrigin } from "@/lib/security";
import { PRIORITIES, TASK_CATEGORIES, TASK_STATUSES } from "@/lib/work";
import { deleteTask, updateTask } from "@/services/work/tasks";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

const Patch = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  category: z.enum(TASK_CATEGORIES).optional(),
  priority: z.enum(PRIORITIES).optional(),
  status: z.enum(TASK_STATUSES).optional(),
  dueDate: z.string().nullable().optional(),
  dependsOn: z.array(z.uuid()).max(20).optional(),
});

export async function PATCH(req: Request, { params }: Ctx) {
  const blocked = rejectCrossOrigin(req);
  if (blocked) return blocked;
  const id = z.uuid().safeParse((await params).id);
  const body = Patch.safeParse(await req.json().catch(() => null));
  if (!id.success || !body.success) return Response.json({ error: "Invalid request" }, { status: 400 });
  try {
    updateTask(getDb(), id.data, body.data);
    return Response.json({ ok: true });
  } catch (e) {
    return domainErrorResponse(e);
  }
}

export async function DELETE(req: Request, { params }: Ctx) {
  const blocked = rejectCrossOrigin(req);
  if (blocked) return blocked;
  const id = z.uuid().safeParse((await params).id);
  return id.success && deleteTask(getDb(), id.data) ? Response.json({ ok: true }) : Response.json({ error: "Not found" }, { status: 404 });
}
