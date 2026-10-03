import { getDb } from "@/db/client";
import { listConversations, searchConversations } from "@/db/queries/conversations";

export const dynamic = "force-dynamic";

export function GET(req: Request) {
  const q = new URL(req.url).searchParams.get("q")?.slice(0, 200) ?? "";
  const db = getDb();
  if (q.trim()) {
    return Response.json({
      conversations: searchConversations(db, q).map((h) => ({ ...h.conversation, snippet: h.snippet })),
    });
  }
  return Response.json({ conversations: listConversations(db).map((c) => ({ ...c, snippet: null })) });
}
