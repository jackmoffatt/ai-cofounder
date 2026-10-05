import type { Db } from "@/db/client";
import {
  addMessage,
  createConversation,
  getConversation,
  listMessages,
  mergeMessageMetadata,
  renameConversation,
} from "@/db/queries/conversations";
import { getProposalRows } from "@/db/queries/memory";
import { readFounder } from "@/services/memory/founder";
import { ingestCandidates } from "@/services/memory/ingest";
import { readActiveStartup } from "@/services/memory/startup";
import { toCard, type ProposalCard } from "@/services/memory/view";
import { modelFor } from "@/services/ai/models";
import { AIError, type AIProvider } from "@/services/ai/types";
import { lastTraceForConversation } from "@/db/queries/context";
import { refreshBriefIfStale } from "@/services/brief";
import type { Mode } from "@/lib/modes";
import type { ToolRegistry } from "@/tools/registry";
import type { ToolCallRecord, ToolContext } from "@/tools/types";
import type { StageKey } from "@/lib/profile";
import { createDefaultRegistry, toolNamesFor } from "@/tools";
import { buildContext } from "./contextBuilder";
import { runModelLoop } from "./loop";
import { planFromReply } from "./planning";
import { createProposal } from "@/services/memory/proposals";
import { classifyIntent } from "./intent";
import { updateSummary } from "./summary";
import { writeTrace } from "./trace";
import { extractMemory } from "./extraction";
import { fallbackTitle, generateTitle } from "./title";

/** Events streamed to the client for one turn. */
export type TurnEvent =
  | { type: "meta"; conversationId: string; isNew: boolean }
  | { type: "delta"; text: string }
  | { type: "title"; title: string }
  | { type: "status"; text: string }
  | { type: "context"; refs: Record<string, { id: string; kind: string; title: string }> }
  | { type: "memory"; changes: MemoryChange[] }
  | { type: "proposals"; proposals: ProposalCard[] }
  | { type: "done"; messageId: string }
  | { type: "error"; code: string; message: string };

/** A memory write made during a turn, shown to the user with a way to undo it. */
export interface MemoryChange {
  eventId: string;
  summary: string;
  reason: string;
  /** Set when the change created or touched a memory item, so the UI can link to it. */
  itemId?: string;
  /** Set when the change created or touched a task. */
  taskId?: string;
}

export interface TurnInput {
  /** Existing conversation, or omit to start one. */
  conversationId?: string;
  /** New user message. Omit to regenerate the reply to the conversation's last user message. */
  message?: string;
  signal?: AbortSignal;
}

const DEFAULT_TITLE = "New chat";

function errorEvent(err: unknown): TurnEvent {
  const e = err instanceof AIError ? err : new AIError("unknown");
  return { type: "error", code: e.code, message: e.message };
}

export async function* runChatTurn(
  deps: { db: Db; provider: AIProvider; registry?: ToolRegistry; research?: ToolContext["research"] },
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

  let userMessage: { id: string; content: string } | null = null;
  if (input.message) {
    const row = addMessage(db, conversation.id, "user", input.message);
    userMessage = { id: row.id, content: row.content };
  } else if (listMessages(db, conversation.id).at(-1)?.role !== "user") {
    yield { type: "error", code: "bad_request", message: "Nothing to retry." };
    return;
  }
  yield { type: "meta", conversationId: conversation.id, isNew };

  const startedAt = Date.now();
  const stored = listMessages(db, conversation.id);
  const askedAbout = userMessage?.content ?? stored.filter((m) => m.role === "user").at(-1)?.content ?? "";

  yield { type: "status", text: "Reviewing startup context…" };
  const startup = readActiveStartup(db);
  const intent = await classifyIntent(provider, {
    message: askedAbout,
    previousMode: (lastTraceForConversation(db, conversation.id)?.mode as Mode | undefined) ?? null,
    stage: (startup?.stage as StageKey | undefined) ?? null,
  });
  const built = buildContext(db, { conversation, stored, intent });
  if (Object.keys(built.refs).length) yield { type: "context", refs: built.refs };
  const traceId = crypto.randomUUID();
  const registry = deps.registry ?? createDefaultRegistry();

  const toolNames = toolNamesFor(intent);
  let text = "";
  let meta: Record<string, unknown> = {};
  let usage = { inputTokens: 0, outputTokens: 0 };
  let servedBy = modelFor("chat");
  let toolRecords: ToolCallRecord[] = [];
  const refs = { ...built.refs };
  let failure: AIError | null = null;
  try {
    for await (const ev of runModelLoop({
      provider,
      registry,
      toolNames,
      model: modelFor("chat"),
      system: built.system,
      messages: built.messages,
      maxTokens: 32000,
      effort: "medium",
      signal: input.signal,
      toolContext: { db, provider, conversationId: conversation.id, research: deps.research },
    })) {
      if (ev.type === "text_delta") {
        text += ev.text;
        yield { type: "delta", text: ev.text };
      } else if (ev.type === "status") {
        yield { type: "status", text: ev.text };
      } else if (ev.type === "refs") {
        Object.assign(refs, ev.refs);
        yield { type: "context", refs: { ...refs } };
      } else {
        usage = ev.usage;
        servedBy = ev.model;
        toolRecords = ev.tools;
        meta = { model: ev.model, usage: ev.usage, stopReason: ev.stopReason, refs, traceId };
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

  // Tell the client the reply is complete first; housekeeping below can take a second or two.
  const latencyMs = Date.now() - startedAt;
  if (failure && failure.code !== "aborted") yield errorEvent(failure);
  else yield { type: "done", messageId: messageId ?? "" };

  if (conversation.title === DEFAULT_TITLE) {
    const firstUser = stored.find((m) => m.role === "user")?.content ?? "";
    const title = failure && !text ? fallbackTitle(firstUser) : await generateTitle(provider, firstUser);
    renameConversation(db, conversation.id, title);
    yield { type: "title", title };
  }

  let memoryEventIds: string[] = [];
  let proposalIds: string[] = [];
  if (userMessage) {
    yield { type: "status", text: "Updating memory…" };
    const known = readFounder(db);
    const previousReply = stored.filter((m) => m.role === "assistant").at(-1)?.content ?? null;
    const { extraction, codes, taskCodes } = await extractMemory(provider, {
      db,
      userMessage: userMessage.content,
      lastAssistantMessage: previousReply,
      knownName: known.name,
      knownProfile: known.profile,
      startup: readActiveStartup(db),
    });
    const { events, proposals } = ingestCandidates(
      db,
      extraction,
      codes,
      { conversationId: conversation.id, messageId: userMessage.id },
      taskCodes,
    );

    // A plan the founder asked for becomes one proposal card: accept to create the objective, experiments and tasks.
    if (intent.wantsPlan && text && !failure) {
      yield { type: "status", text: "Drafting the plan…" };
      const plan = await planFromReply(provider, db, { userMessage: userMessage.content, reply: text });
      const row = plan && createProposal(db, plan, { rationale: "The plan above, ready to save as an objective, experiments and tasks.", originRef: { conversationId: conversation.id, messageId } });
      if (row) proposals.push(row);
    }

    memoryEventIds = events.map((e) => e.id);
    proposalIds = proposals.map((p) => p.id);

    // Attach to the reply (or the user's message if there was none) so the notes survive reloads.
    const anchor = messageId ?? userMessage.id;
    if (events.length || proposals.length) {
      mergeMessageMetadata(db, anchor, { memory: events.map((e) => e.id), proposals: proposals.map((p) => p.id) });
    }
    if (events.length) {
      yield {
        type: "memory",
        changes: events.map((e) => ({
          eventId: e.id,
          summary: e.summary,
          reason: e.reason,
          itemId: (JSON.parse(e.change) as { itemId?: string }).itemId,
          taskId: (JSON.parse(e.change) as { taskId?: string }).taskId,
        })),
      };
    }
    if (proposals.length) {
      yield {
        type: "proposals",
        proposals: getProposalRows(db, proposals.map((p) => p.id)).map(toCard),
      };
    }
  }

  writeTrace(db, {
    id: traceId,
    conversationId: conversation.id,
    messageId: messageId ?? userMessage?.id ?? null,
    context: built.trace,
    memoryEventIds,
    proposalIds,
    tools: toolRecords,
    model: servedBy,
    tokensIn: usage.inputTokens,
    tokensOut: usage.outputTokens,
    latencyMs,
  });

  // Keep long conversations cheap, and keep the brief current. Neither can fail the turn.
  await updateSummary(db, provider, conversation.id);
  void refreshBriefIfStale(db, provider);
}

