"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatItem } from "@/components/chat/Message";
import { notifyConversationsChanged, streamChat } from "@/lib/chatClient";
import { notifyMemoryChanged } from "@/lib/memoryClient";

interface Options {
  conversationId: string | null;
  initialItems: ChatItem[];
  /** A new chat learned its id (first event of the stream). */
  onConversationCreated?: (id: string) => void;
  onTitle?: (title: string) => void;
  /** Something was sent from this session (not a retry of an earlier send). */
  onSent?: () => void;
}

/**
 * One conversation's live state: messages, streaming, errors and the send/stop/retry actions. Owns no
 * layout, so the full chat, the quick overlay and anything else that talks to the Cofounder share it.
 */
export function useChatSession({ conversationId, initialItems, onConversationCreated, onTitle, onSent }: Options) {
  const [items, setItems] = useState<ChatItem[]>(initialItems);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(conversationId);
  const abortRef = useRef<AbortController | null>(null);
  const activeRuns = useRef(0);
  const callbacks = useRef({ onConversationCreated, onTitle, onSent });
  useEffect(() => {
    callbacks.current = { onConversationCreated, onTitle, onSent };
  });

  // Stop any in-flight stream when the session goes away (tab closed).
  useEffect(() => () => abortRef.current?.abort(), []);

  const run = useCallback(
    async (message: string | undefined) => {
      setError(null);
      setStatus(null);
      setStreaming(true);
      activeRuns.current++;
      if (message) callbacks.current.onSent?.();
      const assistantId = `pending-${Date.now()}`;
      setItems((prev) => [
        ...prev,
        ...(message ? [{ id: `u-${Date.now()}`, role: "user" as const, content: message }] : []),
        { id: assistantId, role: "assistant" as const, content: "" },
      ]);

      const ctrl = new AbortController();
      abortRef.current = ctrl;
      let convId = activeId;
      try {
        await streamChat(
          { conversationId: convId ?? undefined, message },
          (e) => {
            switch (e.type) {
              case "meta":
                if (!convId) {
                  convId = e.conversationId;
                  setActiveId(convId);
                  callbacks.current.onConversationCreated?.(convId);
                }
                notifyConversationsChanged();
                break;
              case "delta":
                setItems((prev) => prev.map((it) => (it.id === assistantId ? { ...it, content: it.content + e.text } : it)));
                break;
              case "title":
                callbacks.current.onTitle?.(e.title);
                notifyConversationsChanged();
                break;
              case "context":
                setItems((prev) => prev.map((it) => (it.id === assistantId ? { ...it, refs: e.refs } : it)));
                break;
              case "done":
                // The reply is complete; memory updates may still follow on this stream.
                if (activeRuns.current === 1) setStreaming(false);
                if (e.messageId) setItems((prev) => prev.map((it) => (it.id === assistantId ? { ...it, messageId: e.messageId } : it)));
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
                notifyMemoryChanged();
                break;
              case "proposals":
                setItems((prev) => {
                  const reply = prev.find((it) => it.id === assistantId);
                  const target = reply?.content ? reply : [...prev].reverse().find((it) => it.role === "user");
                  return prev.map((it) => (it === target ? { ...it, proposals: [...(it.proposals ?? []), ...e.proposals] } : it));
                });
                notifyMemoryChanged();
                break;
              case "error":
                setError(e.message);
                break;
            }
          },
          ctrl.signal,
        );
      } catch (err) {
        if (!(err instanceof DOMException && err.name === "AbortError")) setError("Connection lost. Please try again.");
      } finally {
        // Drop an empty placeholder (failed or stopped before any text arrived).
        setItems((prev) => prev.filter((it) => it.id !== assistantId || it.content));
        activeRuns.current--;
        setStatus(null);
        setStreaming(activeRuns.current > 0);
        abortRef.current = null;
      }
    },
    [activeId],
  );

  const stop = useCallback(() => abortRef.current?.abort(), []);

  return { items, streaming, error, status, run, stop };
}
