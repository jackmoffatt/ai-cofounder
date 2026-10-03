import { z } from "zod";
import { toCard } from "@/services/memory/view";
import { getDb } from "@/db/client";
import { listProposalRows } from "@/services/memory/proposals";

export const dynamic = "force-dynamic";

export function GET(req: Request) {
  const status = z.enum(["pending", "accepted", "rejected"]).safeParse(new URL(req.url).searchParams.get("status") ?? undefined);
  return Response.json({ proposals: listProposalRows(getDb(), status.success ? status.data : undefined).map(toCard) });
}
