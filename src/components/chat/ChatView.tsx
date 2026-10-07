"use client";

import { useEffect, useRef, useState } from "react";
import { ChatInput } from "@/components/ui/ChatInput";
import { ContextPanel } from "@/components/context/ContextPanel";
import { ItemPanel } from "@/components/memory/ItemPanel";
import { Button } from "@/components/ui/Button";
import { useChatSession } from "@/lib/useChatSession";
import { useConversations } from "@/lib/useConversations";
import { useDebugMode } from "@/lib/useDebugMode";
import { TracePanel } from "./TracePanel";
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
  /** Whether this is the visible tab. Hidden tabs stay mounted so their state survives. */
  active?: boolean;
  /** Prefills the message box (e.g. from the Research page). */
  initialPrompt?: string;
  /** Something that stops chat from working (e.g. no API key), shown on the empty chat. */
  setupProblem?: string | null;
  onConversationCreated?: (id: string) => void;
  onTitle?: (title: string) => void;
  onSent?: () => void;
  /** Opens another conversation (from the recent list on an empty tab). */
  onOpenConversation?: (id: string, title: string) => void;
  /** A conversation was deleted from the recent list. */
  onConversationDeleted?: (id: string) => void;
}

export function ChatView({ conversationId, initialMessages, active = true, initialPrompt, setupProblem, onConversationCreated, onTitle, onSent, onOpenConversation, onConversationDeleted }: Props) {
  const { items, streaming, error, status, run, stop } = useChatSession({
    conversationId,
    initialItems: initialMessages,
    onConversationCreated,
    onTitle,
    onSent,
  });
  const [panel, setPanel] = useState<{ type: "item" | "trace"; id: string } | null>(null);
  const debug = useDebugMode();
  const rootRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  useEffect(() => {
    const el = scrollRef.current;
    if (el && stick.current) el.scrollTo({ top: el.scrollHeight });
  }, [items]);

  // Coming back to a tab puts the cursor back in its message box.
  const wasActive = useRef(active);
  useEffect(() => {
    if (active && !wasActive.current) rootRef.current?.querySelector("textarea")?.focus({ preventScroll: true });
    wasActive.current = active;
  }, [active]);

  const landing = items.length === 0;

  return (
    <div ref={rootRef} className="flex h-full min-h-0 flex-col">
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
              <Message
                key={it.id}
                item={it}
                pending={streaming && i === items.length - 1}
                onOpenRef={(id) => setPanel({ type: "item", id })}
                onOpenTrace={debug ? (id) => setPanel({ type: "trace", id }) : undefined}
              />
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
            initialValue={initialPrompt}
            streaming={streaming}
            onStop={stop}
            onSend={(text) => {
              stick.current = true;
              void run(text);
            }}
          />
          {landing && (
            <ul className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-sm text-muted">
              {SUGGESTIONS.map((s) => (
                <li key={s.label}>
                  <button
                    onClick={() => void run(s.prompt)}
                    className="transition-colors duration-[var(--dur-fast)] hover:text-fg"
                  >
                    {s.label}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {landing && setupProblem && !error && (
            <p role="status" className="mt-4 text-sm text-muted">
              {setupProblem}
            </p>
          )}
          {landing && error && (
            <p role="alert" className="mt-4 text-sm text-muted">
              {error}
            </p>
          )}
          {landing && active && onOpenConversation && <RecentConversations onOpen={onOpenConversation} onDeleted={onConversationDeleted} />}
        </div>
      </div>

      <ContextPanel open={panel !== null} onClose={() => setPanel(null)} title={panel?.type === "trace" ? "Trace" : "Details"}>
        {panel?.type === "item" && (
          <ItemPanel key={panel.id} itemId={panel.id} onChanged={() => undefined} onDeleted={() => setPanel(null)} />
        )}
        {panel?.type === "trace" && <TracePanel key={panel.id} messageId={panel.id} />}
      </ContextPanel>
    </div>
  );
}

/** The few most recent conversations, offered on an empty tab so history stays one click away. */
function RecentConversations({ onOpen, onDeleted }: { onOpen: (id: string, title: string) => void; onDeleted?: (id: string) => void }) {
  const { items, remove } = useConversations("");
  if (items.length === 0) return null;
  return (
    <section aria-label="Recent conversations" className="mt-12">
      <h2 className="mb-1 text-xs font-medium text-muted">Recent</h2>
      <ul>
        {items.slice(0, 5).map((c) => (
          <li key={c.id} className="group flex items-center gap-2">
            <button
              onClick={() => onOpen(c.id, c.title)}
              className="min-w-0 flex-1 truncate rounded-md px-2 py-1.5 text-left text-sm transition-colors duration-[var(--dur-fast)] hover:bg-surface-2"
            >
              {c.title}
            </button>
            <button
              aria-label={`Delete ${c.title}`}
              onClick={async () => {
                if (window.confirm(`Delete "${c.title}"? This can't be undone.`) && (await remove(c.id))) onDeleted?.(c.id);
              }}
              className="rounded-md px-2 py-1 text-xs text-muted opacity-0 transition-opacity hover:text-fg focus-visible:opacity-100 group-hover:opacity-100"
            >
              Delete
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
