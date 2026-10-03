"use client";

import { useCallback, useEffect, useState } from "react";
import { CONVERSATIONS_CHANGED } from "./chatClient";

export interface ConversationSummary {
  id: string;
  title: string;
  updatedAt: string;
  snippet: string | null;
}

/** Conversation list (or search results when `query` is set). Refreshes when the chat view reports changes. */
export function useConversations(query: string) {
  const [items, setItems] = useState<ConversationSummary[]>([]);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const bump = () => setVersion((v) => v + 1);
    window.addEventListener(CONVERSATIONS_CHANGED, bump);
    return () => window.removeEventListener(CONVERSATIONS_CHANGED, bump);
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    const timer = setTimeout(
      async () => {
        try {
          const res = await fetch(`/api/conversations?q=${encodeURIComponent(query)}`, { signal: ctrl.signal });
          if (res.ok) setItems((await res.json()).conversations);
        } catch {
          /* aborted or offline: keep the previous list */
        }
      },
      query ? 200 : 0,
    );
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [query, version]);

  const remove = useCallback(async (id: string) => {
    const res = await fetch(`/api/conversations/${id}`, { method: "DELETE" });
    if (res.ok) setItems((prev) => prev.filter((c) => c.id !== id));
    return res.ok;
  }, []);

  return { items, remove };
}

/** Groups into "Today" and "Previous" by local calendar day. */
export function groupByDay(items: ConversationSummary[], now = new Date()) {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return {
    today: items.filter((c) => new Date(c.updatedAt).getTime() >= start),
    previous: items.filter((c) => new Date(c.updatedAt).getTime() < start),
  };
}
