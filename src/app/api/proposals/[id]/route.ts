import { z } from "zod";
import { toCard } from "@/services/memory/view";
import { getDb } from "@/db/client";
import { rejectCrossOrigin } from "@/lib/security";
import { ProposalError, acceptProposal, rejectProposal } from "@/services/memory/proposals";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const blocked = rejectCrossOrigin(req);
  if (blocked) return blocked;
  const id = z.uuid().safeParse((await params).id);
  const body = z.object({ action: z.enum(["accept", "reject"]) }).safeParse(await req.json().catch(() => null));
  if (!id.success || !body.success) return Response.json({ error: "Invalid request" }, { status: 400 });
  try {
    const row = body.data.action === "accept" ? acceptProposal(getDb(), id.data) : rejectProposal(getDb(), id.data);
    return Response.json({ proposal: toCard(row) });
  } catch (e) {
    if (e instanceof ProposalError) return Response.json({ error: e.message }, { status: e.message === "Not found" ? 404 : 409 });
    throw e;
  }
}
