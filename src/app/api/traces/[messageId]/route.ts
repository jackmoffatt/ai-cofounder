import { z } from "zod";
import { getDb } from "@/db/client";
import { traceViewForMessage } from "@/services/brief/view";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ messageId: string }> }) {
  const id = z.uuid().safeParse((await params).messageId);
  const trace = id.success ? traceViewForMessage(getDb(), id.data) : null;
  return trace ? Response.json({ trace }) : Response.json({ error: "Not found" }, { status: 404 });
}
