import { z } from "zod";
import { getDb } from "@/db/client";
import { domainErrorResponse } from "@/lib/apiErrors";
import { rejectCrossOrigin } from "@/lib/security";
import { PRIORITIES, TASK_CATEGORIES } from "@/lib/work";
import { readActiveStartup } from "@/services/memory/startup";
import { createTask } from "@/services/work/tasks";
import { currentObjective } from "@/services/work/objectives";

export const dynamic = "force-dynamic";

const Create = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().max(2000).optional(),
  category: z.enum(TASK_CATEGORIES).optional(),
  priority: z.enum(PRIORITIES).optional(),
  dueDate: z.string().nullable().optional(),
  dependsOn: z.array(z.uuid()).max(20).optional(),
  experimentId: z.uuid().nullable().optional(),
});

export async function POST(req: Request) {
  const blocked = rejectCrossOrigin(req);
  if (blocked) return blocked;
  const body = Create.safeParse(await req.json().catch(() => null));
  if (!body.success) return Response.json({ error: "Invalid request" }, { status: 400 });
  const db = getDb();
  try {
    const { task } = createTask(db, {
      ...body.data,
      objectiveId: currentObjective(db)?.id ?? null,
      startupId: readActiveStartup(db)?.id ?? null,
      origin: "manual",
      createdBy: "user",
      reason: "Added by you",
    });
    return Response.json({ id: task.id }, { status: 201 });
  } catch (e) {
    return domainErrorResponse(e);
  }
}
