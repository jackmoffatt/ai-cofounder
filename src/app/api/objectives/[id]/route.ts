import { z } from "zod";
import { getDb } from "@/db/client";
import { domainErrorResponse } from "@/lib/apiErrors";
import { rejectCrossOrigin } from "@/lib/security";
import { OBJECTIVE_STATUSES } from "@/lib/work";
import { updateObjective } from "@/services/work/objectives";

export const dynamic = "force-dynamic";

const Patch = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  successCriteria: z.string().max(1000).optional(),
  status: z.enum(OBJECTIVE_STATUSES).optional(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const blocked = rejectCrossOrigin(req);
  if (blocked) return blocked;
  const id = z.uuid().safeParse((await params).id);
  const body = Patch.safeParse(await req.json().catch(() => null));
  if (!id.success || !body.success) return Response.json({ error: "Invalid request" }, { status: 400 });
  try {
    updateObjective(getDb(), id.data, body.data);
    return Response.json({ ok: true });
  } catch (e) {
    return domainErrorResponse(e);
  }
}
