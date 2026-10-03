"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { notifyConversationsChanged, streamChat } from "@/lib/chatClient";
import { ChatInput } from "@/components/ui/ChatInput";
import { Button } from "@/components/ui/Button";
import { Message, type ChatItem } from "./Message";

const SUGGESTIONS: Array<{ label: string; prompt: string }> = [
  { label: "Explore an idea", prompt: "I have an idea I want to explore." },
  { label: "Research a market", prompt: "I want to research a market. Help me figure out where to start." },
  { label: "Review startup", prompt: "Let's review where the startup stands." },
  { label: "Plan next steps", prompt: "Help me plan my next steps." },
];

interface Props {
  conversationId: string | null;
  initialMessages: ChatItem[];
}

export function ChatView({ conversationId, initialMessages }: Props) {
  const router = useRouter();
  const [items, setItems] = useState<ChatItem[]>(initialMessages);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  // Navigating between conversations remounts this component (the route segment changes), so props
  // only seed state. For a brand-new chat we learn the id mid-stream and adopt it here.
  const [activeId, setActiveId] = useState<string | null>(conversationId);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const activeRuns = useRef(0);
  const pendingNav = useRef<string | null>(null);

  // Stop any in-flight stream when leaving.
  useEffect(() => () => abortRef.current?.abort(), []);

  useEffect(() => {
    const el = scrollRef.current;
    if (el && stick.current) el.scrollTo({ top: el.scrollHeight });
  }, [items]);

  const run = useCallback(
    async (message: string | undefined) => {
      setError(null);
      setStatus(null);
      setStreaming(true);
      activeRuns.current++;
      stick.current = true;
      const assistantId = `pending-${Date.now()}`;
      setItems((prev) => [
        ...prev,
        ...(message ? [{ id: `u-${Date.now()}`, role: "user" as const, content: message }] : []),
        { id: assistantId, role: "assistant" as const, content: "" },
      ]);

      const ctrl = new AbortController();
      abortRef.current = ctrl;
      let convId = activeId;
      let failed = false;
      try {
        await streamChat(
          { conversationId: convId ?? undefined, message },
          (e) => {
            switch (e.type) {
              case "meta":
                if (!convId) {
                  convId = e.conversationId;
                  pendingNav.current = convId;
                  setActiveId(convId);
                }
                notifyConversationsChanged();
                break;
              case "delta":
                setItems((prev) =>
                  prev.map((it) => (it.id === assistantId ? { ...it, content: it.content + e.text } : it)),
                );
                break;
              case "title":
                notifyConversationsChanged();
                break;
              case "done":
                // The reply is complete; memory updates may still follow on this stream.
                if (activeRuns.current === 1) setStreaming(false);
                break;
              case "status":
                setStatus(e.text);
                break;
              case "memory":
                setItems((prev) => {
                  const reply = prev.find((it) => it.id === assistantId);
                  const target = reply?.content ? reply : [...prev].reverse().find((it) => it.role === "user");
                  const notes = e.changes.map((c) => ({ ...c, undone: false }));
                  return prev.map((it) => (it === target ? { ...it, notes: [...(it.notes ?? []), ...notes] } : it));
                });
                break;
              case "error":
                failed = true;
                setError(e.message);
                break;
            }
          },
          ctrl.signal,
        );
      } catch (err) {
        if (!(err instanceof DOMException && err.name === "AbortError")) {
          failed = true;
          setError("Connection lost. Please try again.");
        }
      } finally {
        // Drop an empty placeholder (failed or stopped before any text arrived).
        setItems((prev) => prev.filter((it) => it.id !== assistantId || it.content));
        activeRuns.current--;
        setStatus(null);
        setStreaming(activeRuns.current > 0);
        abortRef.current = null;
        // Everything is saved by now: move a new chat to its own URL (this remounts onto server data).
        if (pendingNav.current && !failed && !ctrl.signal.aborted && activeRuns.current === 0) {
          router.replace(`/c/${pendingNav.current}`);
          pendingNav.current = null;
        }
      }
    },
    [activeId, router],
  );

  const landing = items.length === 0;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {!landing && (
        <div
          ref={scrollRef}
          onScroll={(e) => {
            const el = e.currentTarget;
            stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
          }}
          className="min-h-0 flex-1 overflow-y-auto"
        >
          <div className="mx-auto flex w-full max-w-[720px] flex-col gap-6 px-4 pb-8 pt-16">
            {items.map((it, i) => (
              <Message key={it.id} item={it} pending={streaming && i === items.length - 1} />
            ))}
            {error && (
              <div role="alert" className="flex items-center gap-3 rounded-lg bg-surface-2 px-4 py-3 text-sm">
                <span className="flex-1 text-muted">{error}</span>
                <Button onClick={() => run(undefined)} disabled={streaming}>
                  Try again
                </Button>
              </div>
            )}
          </div>
        </div>
      )}

      <div className={landing ? "flex flex-1 flex-col justify-center px-4 pb-24" : "shrink-0 px-4 pb-6 pt-2"}>
        <div className="mx-auto w-full max-w-[720px]">
          {landing && (
            <>
              <p className="text-sm text-muted">AI Co-Founder</p>
              <h1 className="mb-8 mt-1 text-[length:var(--fs-3xl)] font-semibold leading-tight tracking-tight">
                What are we working on?
              </h1>
            </>
          )}
          <p aria-live="polite" className="h-5 text-xs text-muted">
            {status}
          </p>
          <ChatInput
            autoFocus
            streaming={streaming}
            onStop={() => abortRef.current?.abort()}
            onSend={(text) => run(text)}
          />
          {landing && (
            <ul className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-sm text-muted">
              {SUGGESTIONS.map((s) => (
                <li key={s.label}>
                  <button
                    onClick={() => run(s.prompt)}
                    className="transition-colors duration-[var(--dur-fast)] hover:text-fg"
                  >
                    {s.label}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {landing && error && (
            <p role="alert" className="mt-4 text-sm text-muted">
              {error}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
