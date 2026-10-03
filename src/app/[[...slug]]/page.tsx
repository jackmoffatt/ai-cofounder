import { notFound } from "next/navigation";
import { z } from "zod";
import { ChatView } from "@/components/chat/ChatView";
import { getDb } from "@/db/client";
import { getConversation, listMessages } from "@/db/queries/conversations";

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
  const initialMessages = listMessages(db, id.data).map((m) => ({ id: m.id, role: m.role, content: m.content }));
  return <ChatView conversationId={id.data} initialMessages={initialMessages} />;
}
