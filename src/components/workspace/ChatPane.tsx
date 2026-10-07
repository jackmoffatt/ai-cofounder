"use client";

import { useEffect, useState } from "react";
import { ChatView } from "@/components/chat/ChatView";
import type { ChatItem } from "@/components/chat/Message";
import { Button } from "@/components/ui/Button";
import type { Tab } from "@/lib/tabs";
import { useWorkspace } from "./WorkspaceProvider";

type Load = { status: "loading" } | { status: "error" } | { status: "ready"; items: ChatItem[]; title?: string };

/** One tab's chat. Loads a stored conversation once, then hands it to the chat view and never reloads:
 *  from then on the view holds the live state, so a stream or draft survives switching tabs. */
export function ChatPane({ tab, active }: { tab: Tab; active: boolean }) {
  const ws = useWorkspace();
  // Only the id the tab opened with matters; a new chat gaining an id mid-stream must not trigger a load.
  const [openedWith] = useState(tab.conversationId);
  const [prompt] = useState(() => (tab.conversationId ? undefined : ws.promptFor(tab.key)));
  const [load, setLoad] = useState<Load>(openedWith ? { status: "loading" } : { status: "ready", items: [] });
  const [attempt, setAttempt] = useState(0);

  const { key, title } = tab;
  const { patch, close } = ws;
  useEffect(() => {
    const id = openedWith;
    if (!id) return;
    const ctrl = new AbortController();
    fetch(`/api/conversations/${id}/chat`, { signal: ctrl.signal })
      .then(async (res) => {
        if (res.status === 404) return close(key); // deleted elsewhere
        if (!res.ok) return setLoad({ status: "error" });
        const data = (await res.json()) as { title: string; items: ChatItem[] };
        setLoad({ status: "ready", items: data.items, title: data.title });
        if (data.title !== title) patch(key, { title: data.title });
      })
      .catch((e) => {
        if (!(e instanceof DOMException && e.name === "AbortError")) setLoad({ status: "error" });
      });
    return () => ctrl.abort();
    // `title` and the workspace callbacks are intentionally not dependencies: this loads once per attempt.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);

  if (load.status === "loading") return <p className="px-6 pt-20 text-center text-sm text-muted">Loading…</p>;
  if (load.status === "error") {
    return (
      <div className="flex flex-col items-center gap-3 pt-20 text-sm text-muted">
        <p>Couldn&apos;t load this conversation.</p>
        <Button
          onClick={() => {
            setLoad({ status: "loading" });
            setAttempt((a) => a + 1);
          }}
        >
          Try again
        </Button>
      </div>
    );
  }

  return (
    <ChatView
      conversationId={openedWith}
      initialMessages={load.items}
      initialPrompt={prompt}
      setupProblem={ws.setupProblem}
      active={active}
      onConversationCreated={(id) => patch(key, { conversationId: id })}
      onTitle={(t) => patch(key, { title: t })}
      onSent={() => patch(key, { used: true })}
      onOpenConversation={ws.open}
      onConversationDeleted={ws.closeConversation}
    />
  );
}
