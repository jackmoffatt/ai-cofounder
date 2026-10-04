import { z } from "zod";
import { getDb } from "@/db/client";
import { domainErrorResponse } from "@/lib/apiErrors";
import { rejectCrossOrigin } from "@/lib/security";
import { completeExperiment } from "@/services/work/experiments";

export const dynamic = "force-dynamic";

const Body = z.object({
  result: z.string().trim().min(1).max(2000),
  conclusion: z.string().max(2000).optional(),
  nextAction: z.string().max(1000).optional(),
  evidence: z.object({ stance: z.enum(["supports", "weakens"]), strength: z.enum(["anecdotal", "moderate", "strong"]) }).optional(),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const blocked = rejectCrossOrigin(req);
  if (blocked) return blocked;
  const id = z.uuid().safeParse((await params).id);
  const body = Body.safeParse(await req.json().catch(() => null));
  if (!id.success || !body.success) return Response.json({ error: "Invalid request" }, { status: 400 });
  try {
    completeExperiment(getDb(), id.data, body.data);
    return Response.json({ ok: true });
  } catch (e) {
    return domainErrorResponse(e);
  }
}
