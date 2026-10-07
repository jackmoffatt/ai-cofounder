import type { Db } from "@/db/client";
import { getConversation, listMessages } from "@/db/queries/conversations";
import { getProposalRows } from "@/db/queries/memory";
import { getEvents } from "@/db/queries/profile";
import type { ChatItem } from "@/components/chat/Message";
import { toCard } from "@/services/memory/view";

/** A stored conversation shaped for the chat view: messages plus the memory notes, proposal cards and
 *  citation handles that each message's metadata points at. Null when the conversation doesn't exist. */
export function loadChatView(db: Db, id: string): { id: string; title: string; items: ChatItem[] } | null {
  const conversation = getConversation(db, id);
  if (!conversation) return null;
  const rows = listMessages(db, id);
  const events = new Map(getEvents(db, rows.flatMap((m) => idsOf(m.metadata, "memory"))).map((e) => [e.id, e]));
  const proposals = new Map(getProposalRows(db, rows.flatMap((m) => idsOf(m.metadata, "proposals"))).map((p) => [p.id, toCard(p)]));
  const items = rows.map((m): ChatItem => {
    const notes = idsOf(m.metadata, "memory").flatMap((eid) => {
      const e = events.get(eid);
      return e ? [{ eventId: e.id, summary: e.summary, reason: e.reason, undone: e.undoneAt !== null, itemId: changeId(e.change, "itemId"), taskId: changeId(e.change, "taskId") }] : [];
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
  return { id: conversation.id, title: conversation.title, items };
}

function idsOf(metadata: string, key: "memory" | "proposals"): string[] {
  try {
    const ids = JSON.parse(metadata)[key];
    return Array.isArray(ids) ? ids.filter((i): i is string => typeof i === "string") : [];
  } catch {
    return [];
  }
}

function changeId(change: string, key: "itemId" | "taskId"): string | undefined {
  try {
    const id = JSON.parse(change)[key];
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
