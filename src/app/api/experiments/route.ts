import { z } from "zod";
import { getDb } from "@/db/client";
import { domainErrorResponse } from "@/lib/apiErrors";
import { rejectCrossOrigin } from "@/lib/security";
import { currentObjective } from "@/services/work/objectives";
import { createExperiment } from "@/services/work/experiments";

export const dynamic = "force-dynamic";

const Create = z.object({
  hypothesis: z.string().trim().min(1).max(400),
  method: z.string().max(1000).optional(),
  successCriteria: z.string().max(1000).optional(),
  assumptionId: z.uuid().nullable().optional(),
});

export async function POST(req: Request) {
  const blocked = rejectCrossOrigin(req);
  if (blocked) return blocked;
  const body = Create.safeParse(await req.json().catch(() => null));
  if (!body.success) return Response.json({ error: "Invalid request" }, { status: 400 });
  const db = getDb();
  try {
    const e = createExperiment(db, { ...body.data, objectiveId: currentObjective(db)?.id ?? null, createdBy: "user", reason: "Added by you" });
    return Response.json({ id: e.id }, { status: 201 });
  } catch (e) {
    return domainErrorResponse(e);
  }
}
