import { notFound } from "next/navigation";
import { z } from "zod";
import { ChatView } from "@/components/chat/ChatView";
import { getDb } from "@/db/client";
import { getConversation, listMessages } from "@/db/queries/conversations";
import { getProposalRows } from "@/db/queries/memory";
import { getEvents } from "@/db/queries/profile";
import { toCard } from "@/services/memory/view";

export const dynamic = "force-dynamic";

/** `/` is a new chat; `/c/<id>` is an existing one. One page component serves both so the chat view
 *  stays mounted when a new conversation gets its id mid-stream. */
export default async function Page({ params, searchParams }: { params: Promise<{ slug?: string[] }>; searchParams: Promise<{ ask?: string }> }) {
  const { slug } = await params;
  if (!slug) return <ChatView conversationId={null} initialMessages={[]} initialPrompt={(await searchParams).ask?.slice(0, 500)} />;

  const id = slug.length === 2 && slug[0] === "c" ? z.uuid().safeParse(slug[1]) : null;
  if (!id?.success) notFound();

  const db = getDb();
  if (!getConversation(db, id.data)) notFound();
  const rows = listMessages(db, id.data);
  const eventIds = rows.flatMap((m) => idsOf(m.metadata, "memory"));
  const events = new Map(getEvents(db, eventIds).map((e) => [e.id, e]));
  const proposals = new Map(getProposalRows(db, rows.flatMap((m) => idsOf(m.metadata, "proposals"))).map((p) => [p.id, toCard(p)]));
  const initialMessages = rows.map((m) => {
    const notes = idsOf(m.metadata, "memory").flatMap((eid) => {
      const e = events.get(eid);
      return e ? [{ eventId: e.id, summary: e.summary, reason: e.reason, undone: e.undoneAt !== null, itemId: itemIdOf(e.change), taskId: taskIdOf(e.change) }] : [];
    });
    const cards = idsOf(m.metadata, "proposals").flatMap((pid) => proposals.get(pid) ?? []);
    return {
      id: m.id,
      role: m.role,
      content: m.content,
      messageId: m.id,
      ...(notes.length ? { notes } : {}),
      ...(cards.length ? { proposals: cards } : {}),
      ...(m.role === "assistant" ? { refs: refsOf(m.metadata) } : {}),
    };
  });
  return <ChatView conversationId={id.data} initialMessages={initialMessages} />;
}

function idsOf(metadata: string, key: "memory" | "proposals"): string[] {
  try {
    const ids = JSON.parse(metadata)[key];
    return Array.isArray(ids) ? ids.filter((i): i is string => typeof i === "string") : [];
  } catch {
    return [];
  }
}

function itemIdOf(change: string): string | undefined {
  try {
    const id = JSON.parse(change).itemId;
    return typeof id === "string" ? id : undefined;
  } catch {
    return undefined;
  }
}

function refsOf(metadata: string): Record<string, { id: string; kind: string; title: string }> {
  try {
    const refs = JSON.parse(metadata).refs;
    return refs && typeof refs === "object" ? refs : {};
  } catch {
    return {};
  }
}

function taskIdOf(change: string): string | undefined {
  try {
    const id = JSON.parse(change).taskId;
    return typeof id === "string" ? id : undefined;
  } catch {
    return undefined;
  }
}
