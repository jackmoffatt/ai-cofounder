import { z } from "zod";
import { getDb } from "@/db/client";
import { loadChatView } from "@/services/conversations/view";

export const dynamic = "force-dynamic";

/** A conversation ready to render in a workspace tab (messages with their memory notes, proposals and refs). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = z.uuid().safeParse((await params).id);
  const view = id.success ? loadChatView(getDb(), id.data) : null;
  return view ? Response.json(view) : Response.json({ error: "Not found" }, { status: 404 });
}
