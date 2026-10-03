import { notFound } from "next/navigation";
import { z } from "zod";
import { ChatView } from "@/components/chat/ChatView";
import { getDb } from "@/db/client";
import { getConversation, listMessages } from "@/db/queries/conversations";
import { getEvents } from "@/db/queries/profile";

export const dynamic = "force-dynamic";

/** `/` is a new chat; `/c/<id>` is an existing one. One page component serves both so the chat view
 *  stays mounted when a new conversation gets its id mid-stream. */
export default async function Page({ params }: { params: Promise<{ slug?: string[] }> }) {
  const { slug } = await params;
  if (!slug) return <ChatView conversationId={null} initialMessages={[]} />;

  const id = slug.length === 2 && slug[0] === "c" ? z.uuid().safeParse(slug[1]) : null;
  if (!id?.success) notFound();

  const db = getDb();
  if (!getConversation(db, id.data)) notFound();
  const rows = listMessages(db, id.data);
  const eventIds = rows.flatMap((m) => memoryIds(m.metadata));
  const events = new Map(getEvents(db, eventIds).map((e) => [e.id, e]));
  const initialMessages = rows.map((m) => {
    const notes = memoryIds(m.metadata).flatMap((eid) => {
      const e = events.get(eid);
      return e ? [{ eventId: e.id, summary: e.summary, reason: e.reason, undone: e.undoneAt !== null }] : [];
    });
    return { id: m.id, role: m.role, content: m.content, ...(notes.length ? { notes } : {}) };
  });
  return <ChatView conversationId={id.data} initialMessages={initialMessages} />;
}

function memoryIds(metadata: string): string[] {
  try {
    const ids = JSON.parse(metadata).memory;
    return Array.isArray(ids) ? ids.filter((i): i is string => typeof i === "string") : [];
  } catch {
    return [];
  }
}
