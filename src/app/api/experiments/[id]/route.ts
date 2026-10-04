import { z } from "zod";
import { getDb } from "@/db/client";
import { domainErrorResponse } from "@/lib/apiErrors";
import { rejectCrossOrigin } from "@/lib/security";
import { EXPERIMENT_STATUSES } from "@/lib/work";
import { updateExperiment } from "@/services/work/experiments";

export const dynamic = "force-dynamic";

const Patch = z.object({
  hypothesis: z.string().trim().min(1).max(400).optional(),
  method: z.string().max(1000).optional(),
  successCriteria: z.string().max(1000).optional(),
  status: z.enum(EXPERIMENT_STATUSES).optional(),
  result: z.string().max(2000).optional(),
  conclusion: z.string().max(2000).optional(),
  nextAction: z.string().max(1000).optional(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const blocked = rejectCrossOrigin(req);
  if (blocked) return blocked;
  const id = z.uuid().safeParse((await params).id);
  const body = Patch.safeParse(await req.json().catch(() => null));
  if (!id.success || !body.success) return Response.json({ error: "Invalid request" }, { status: 400 });
  try {
    updateExperiment(getDb(), id.data, body.data);
    return Response.json({ ok: true });
  } catch (e) {
    return domainErrorResponse(e);
  }
}
