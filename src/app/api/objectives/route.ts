import { z } from "zod";
import { getDb } from "@/db/client";
import { domainErrorResponse } from "@/lib/apiErrors";
import { rejectCrossOrigin } from "@/lib/security";
import { createObjective } from "@/services/work/objectives";

export const dynamic = "force-dynamic";

const Create = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().max(2000).optional(),
  successCriteria: z.string().max(1000).optional(),
});

export async function POST(req: Request) {
  const blocked = rejectCrossOrigin(req);
  if (blocked) return blocked;
  const body = Create.safeParse(await req.json().catch(() => null));
  if (!body.success) return Response.json({ error: "Invalid request" }, { status: 400 });
  try {
    const o = createObjective(getDb(), { ...body.data, createdBy: "user", reason: "Set by you" });
    return Response.json({ id: o.id }, { status: 201 });
  } catch (e) {
    return domainErrorResponse(e);
  }
}
