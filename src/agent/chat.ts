import type { Db } from "@/db/client";
import {
  addMessage,
  createConversation,
  getConversation,
  listMessages,
  renameConversation,
} from "@/db/queries/conversations";
import { modelFor } from "@/services/ai/models";
import { AIError, type AIProvider, type ChatMessage } from "@/services/ai/types";
import { SYSTEM_PROMPT } from "./systemPrompt";
import { fallbackTitle, generateTitle } from "./title";

/** Events streamed to the client for one turn. */
export type TurnEvent =
  | { type: "meta"; conversationId: string; isNew: boolean }
  | { type: "delta"; text: string }
  | { type: "title"; title: string }
  | { type: "done"; messageId: string }
  | { type: "error"; code: string; message: string };

export interface TurnInput {
  /** Existing conversation, or omit to start one. */
  conversationId?: string;
  /** New user message. Omit to regenerate the reply to the conversation's last user message. */
  message?: string;
  signal?: AbortSignal;
}

/** M1 keeps it simple: the most recent messages. Retrieval and summaries replace this in M4. */
const MAX_HISTORY_MESSAGES = 40;
const DEFAULT_TITLE = "New chat";

function errorEvent(err: unknown): TurnEvent {
  const e = err instanceof AIError ? err : new AIError("unknown");
  return { type: "error", code: e.code, message: e.message };
}

export async function* runChatTurn(
  deps: { db: Db; provider: AIProvider },
  input: TurnInput,
): AsyncGenerator<TurnEvent> {
  const { db, provider } = deps;

  let conversation = input.conversationId ? getConversation(db, input.conversationId) : undefined;
  if (input.conversationId && !conversation) {
    yield { type: "error", code: "not_found", message: "That conversation no longer exists." };
    return;
  }
  const isNew = !conversation;
  if (isNew && !input.message) {
    yield { type: "error", code: "bad_request", message: "Nothing to send." };
    return;
  }
  conversation ??= createConversation(db, DEFAULT_TITLE);

  if (input.message) {
    addMessage(db, conversation.id, "user", input.message);
  } else if (listMessages(db, conversation.id).at(-1)?.role !== "user") {
    yield { type: "error", code: "bad_request", message: "Nothing to retry." };
    return;
  }
  yield { type: "meta", conversationId: conversation.id, isNew };

  const stored = listMessages(db, conversation.id);
  const history: ChatMessage[] = stored.slice(-MAX_HISTORY_MESSAGES).map((m) => ({ role: m.role, content: m.content }));
  // The API requires the first message to be from the user.
  while (history.length > 1 && history[0].role !== "user") history.shift();

  let text = "";
  let meta: Record<string, unknown> = {};
  let failure: AIError | null = null;
  try {
    for await (const ev of provider.stream({
      model: modelFor("chat"),
      system: SYSTEM_PROMPT,
      messages: history,
      maxTokens: 32000,
      effort: "medium",
      signal: input.signal,
    })) {
      if (ev.type === "text_delta") {
        text += ev.text;
        yield { type: "delta", text: ev.text };
      } else {
        meta = { model: ev.model, usage: ev.usage, stopReason: ev.stopReason };
        if (ev.stopReason === "refusal" && !text) failure = new AIError("refused");
      }
    }
  } catch (err) {
    failure = err instanceof AIError ? err : new AIError("unknown");
  }

  // Keep whatever was produced, even if the stream was cut short, so nothing the user saw is lost.
  let messageId: string | null = null;
  if (text) {
    messageId = addMessage(db, conversation.id, "assistant", text, failure ? { ...meta, interrupted: true } : meta).id;
  }

  if (conversation.title === DEFAULT_TITLE && !input.signal?.aborted) {
    const firstUser = stored.find((m) => m.role === "user")?.content ?? "";
    const title = failure && !text ? fallbackTitle(firstUser) : await generateTitle(provider, firstUser);
    renameConversation(db, conversation.id, title);
    yield { type: "title", title };
  }

  if (failure) {
    yield failure.code === "aborted" ? { type: "done", messageId: messageId ?? "" } : errorEvent(failure);
    return;
  }
  yield { type: "done", messageId: messageId ?? "" };
}
