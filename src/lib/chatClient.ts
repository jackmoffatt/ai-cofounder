import type { TurnEvent } from "@/agent/chat";

/** POSTs a turn and invokes `onEvent` for each server-sent event as it arrives. */
export async function streamChat(
  body: { conversationId?: string; message?: string },
  onEvent: (e: TurnEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) {
    onEvent({ type: "error", code: "http", message: "The request failed. Please try again." });
    return;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let end: number;
    while ((end = buffer.indexOf("\n\n")) >= 0) {
      const frame = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      const data = frame.split("\n").find((l) => l.startsWith("data: "));
      if (data) onEvent(JSON.parse(data.slice(6)) as TurnEvent);
    }
  }
}

export const CONVERSATIONS_CHANGED = "conversations:changed";
export const notifyConversationsChanged = () => window.dispatchEvent(new Event(CONVERSATIONS_CHANGED));
