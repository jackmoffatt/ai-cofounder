import type { Db } from "@/db/client";
import { recentConversations } from "@/db/queries/conversations";
import { latestBrief } from "@/db/queries/context";
import { recentEvents } from "@/db/queries/memory";
import type { Conversation, Message } from "@/db/schema";
import { KIND_LABELS, refFor } from "@/lib/memory";
import { MODE_GUIDANCE, PLAN_GUIDANCE } from "@/lib/modes";
import { FOUNDER_FIELDS, STARTUP_FIELDS, founderFieldCount, stageLabel } from "@/lib/profile";
import { estimateTokens, truncateToTokens } from "@/lib/tokens";
import type { ChatMessage } from "@/services/ai/types";
import { readFounder } from "@/services/memory/founder";
import { readActiveStartup } from "@/services/memory/startup";
import { listMessages } from "@/db/queries/conversations";
import { isOpen, todayLocal } from "@/lib/work";
import { currentObjective } from "@/services/work/objectives";
import { listExperimentRows } from "@/db/queries/work";
import { getItem } from "@/db/queries/memory";
import { listTaskViews } from "@/services/work/tasks";
import type { Intent } from "./intent";
import { retrieve, type Reason } from "./retrieval";
import { SYSTEM_PROMPT } from "./systemPrompt";

/** Token budgets per section. The sum is deliberately far below the model's window: cost and focus. */
export const BUDGETS = {
  brief: 2000,
  memory: 1800,
  recall: 700,
  work: 800,
  summary: 600,
  history: 8000,
} as const;

/** Cap on raw history even when the summary lags behind. */
const MAX_RAW_MESSAGES = 40;
/** Below this many filled profile fields (and with no startup), the agent leans into discovery. */
const SPARSE_FOUNDER_FIELDS = 4;

export interface TraceItem {
  ref: string;
  id: string;
  kind: string;
  title: string;
  status: string;
  reason: Reason;
}

export interface ContextTrace {
  intent: Intent;
  sections: Array<{ name: string; tokens: number }>;
  items: TraceItem[];
  historyMessages: number;
  summarizedMessages: number;
  briefVersion: number | null;
  totalTokens: number;
}

export interface BuiltContext {
  system: string;
  messages: ChatMessage[];
  /** handle -> item, so the UI can turn [m:handle] citations into links. */
  refs: Record<string, { id: string; kind: string; title: string }>;
  trace: ContextTrace;
}

const CITE_RULE =
  "When your answer relies on a specific recorded item, cite it inline with its handle exactly as shown, like [m:ab12cd34]. Only cite handles listed above; never invent one.";

function founderSection(db: Db): { text: string; filledFields: number } {
  const founder = readFounder(db);
  const lines = FOUNDER_FIELDS.flatMap((f) => {
    const items = founder.profile[f.key];
    return items?.length ? [`- ${f.label}: ${items.join("; ")}`] : [];
  });
  if (founder.name) lines.unshift(`- Name: ${founder.name}`);
  const filled = founderFieldCount(founder.profile) + (founder.name ? 1 : 0);
  return {
    filledFields: filled,
    text: lines.length
      ? `## About the founder\nThis is what the founder has told you about themselves.\n${lines.join("\n")}\n\nShape recommendations around what is realistic for this person. If a suggestion conflicts with something above, say so rather than ignoring it.`
      : "## About the founder\nYou know nothing about the founder yet.",
  };
}

function startupSection(db: Db): string {
  const startup = readActiveStartup(db);
  if (!startup) {
    return "## The startup\nNo startup has been established yet. The founder is still exploring. Do not assume or invent an idea.";
  }
  const lines = [
    `- Name: ${startup.name}`,
    `- Stage: ${stageLabel(startup.stage)}`,
    `- Current objective: ${startup.currentObjective || "not set"}`,
    ...STARTUP_FIELDS.flatMap((f) => (startup.profile[f.key] ? [`- ${f.label}: ${startup.profile[f.key]}`] : [])),
  ];
  return `## The startup\nThese are the founder's own statements: beliefs and intentions, not verified facts, until backed by evidence. If the brief below disagrees with this list, this list is current.\n${lines.join("\n")}`;
}

function memoryLine(r: ReturnType<typeof retrieve>[number]): string {
  const { item } = r;
  const bits = [item.kind === "insight" ? "customer insight, founder-reported" : item.kind, item.status];
  if (item.kind === "assumption") {
    bits.push(`${item.confidence} confidence`, r.evidenceCount === 0 ? "no evidence" : `${r.evidenceCount} piece${r.evidenceCount === 1 ? "" : "s"} of evidence`);
  }
  let line = `- [m:${refFor(item.id)}] ${item.title} (${bits.join(" · ")})`;
  const reasoning = (() => {
    try {
      return (JSON.parse(item.data) as { reasoning?: string }).reasoning || item.body;
    } catch {
      return item.body;
    }
  })();
  if (item.kind === "decision" && reasoning) line += `\n  Reasoning: ${reasoning.slice(0, 240)}`;
  else if (item.body) line += `\n  Notes: ${item.body.slice(0, 160)}`;
  return line;
}

function memorySection(retrieved: ReturnType<typeof retrieve>): { text: string | null; used: ReturnType<typeof retrieve> } {
  const used: typeof retrieved = [];
  const lines: string[] = [];
  let tokens = 0;
  for (const r of retrieved) {
    const line = memoryLine(r);
    const t = estimateTokens(line);
    if (tokens + t > BUDGETS.memory) break;
    tokens += t;
    lines.push(line);
    used.push(r);
  }
  if (!lines.length) return { text: null, used };
  return {
    used,
    text: `## Relevant recorded knowledge
Treat each line by its label. An assumption is a belief to test, not a fact, whatever its confidence; "validated" is the only status meaning the founder accepts it as established. Say so when advice leans on an untested assumption, and when new information conflicts with something here.

${lines.join("\n")}`,
  };
}

function recallSection(db: Db, conversationId: string | null): string | null {
  const convs = recentConversations(db, conversationId ?? "", 4);
  const events = recentEvents(db, 8);
  const parts: string[] = [];
  if (convs.length) {
    parts.push(
      "Recent conversations:\n" +
        convs
          .map((c) => {
            const msgs = listMessages(db, c.id);
            const gist = c.summary || msgs.slice(-2).map((m) => `${m.role === "user" ? "Founder" : "Co-founder"}: ${m.content.slice(0, 200)}`).join(" / ");
            return `- "${c.title}" (${c.updatedAt.slice(0, 10)}): ${gist.slice(0, 400)}`;
          })
          .join("\n"),
    );
  }
  if (events.length) parts.push("Recent changes to memory:\n" + events.map((e) => `- ${e.createdAt.slice(0, 10)} ${e.actor === "agent" ? "(you)" : "(founder)"} ${e.summary}`).join("\n"));
  return parts.length ? truncateToTokens(`## Where things were left\n${parts.join("\n\n")}`, BUDGETS.recall) : null;
}

/** The objective, running experiments and open tasks. Small enough to always include. */
export function workSection(db: Db, today = todayLocal()): string | null {
  const objective = currentObjective(db);
  const experiments = listExperimentRows(db).filter((e) => e.status === "planned" || e.status === "running").slice(0, 6);
  const tasks = listTaskViews(db, today).filter((t) => isOpen(t.status));
  if (!objective && !experiments.length && !tasks.length) return null;

  const parts: string[] = [];
  if (objective) parts.push(`Objective: ${objective.title}${objective.successCriteria ? `\nSuccess criteria: ${objective.successCriteria}` : ""}`);
  if (experiments.length) {
    parts.push(
      "Experiments:\n" +
        experiments
          .map((e) => {
            const a = e.assumptionId ? getItem(db, e.assumptionId) : undefined;
            return `- [${e.status}] ${e.hypothesis}${e.method ? ` — ${e.method}` : ""}${a ? ` (tests: ${a.title})` : ""}`;
          })
          .join("\n"),
    );
  }
  if (tasks.length) {
    const shown = tasks.slice(0, 12);
    parts.push(
      `Open tasks (most important first, ${tasks.length} total):\n` +
        shown
          .map((t) => {
            const bits = [t.effectiveStatus, t.priority, t.dueDate ? `${t.overdue ? "OVERDUE, " : ""}due ${t.dueDate}` : null, t.blockedBy.length ? `blocked by "${t.blockedBy[0].title}"` : null].filter(Boolean);
            return `- ${t.title} (${bits.join(" · ")})`;
          })
          .join("\n"),
    );
  }
  return truncateToTokens(`## Current work\nToday is ${today}.\n${parts.join("\n\n")}`, BUDGETS.work);
}

/** The raw messages to send: everything the summary doesn't cover, within a token budget. */
function historyWindow(conv: Conversation | null, stored: Message[]): ChatMessage[] {
  const start = Math.max(conv?.summaryCount ?? 0, stored.length - MAX_RAW_MESSAGES, 0);
  const msgs: ChatMessage[] = stored.slice(start).map((m) => ({ role: m.role, content: m.content }));
  let tokens = msgs.reduce((n, m) => n + estimateTokens(m.content), 0);
  while (msgs.length > 1 && tokens > BUDGETS.history) tokens -= estimateTokens(msgs.shift()!.content);
  while (msgs.length > 1 && msgs[0].role !== "user") msgs.shift(); // the API needs the first message to be the user's
  return msgs;
}

export interface BuildInput {
  conversation: Conversation | null;
  /** All stored messages of the conversation, including the one being answered. */
  stored: Message[];
  intent: Intent;
}

/**
 * Assembles what the model sees for one turn: persona, who the founder is, the startup and its brief,
 * the memory relevant to *this* message, and a bounded slice of the conversation. Returns a trace of
 * exactly what went in, so the choice is inspectable.
 */
export function buildContext(db: Db, input: BuildInput): BuiltContext {
  const { intent, conversation, stored } = input;
  const sections: Array<{ name: string; text: string }> = [{ name: "persona", text: SYSTEM_PROMPT }];

  const founder = founderSection(db);
  sections.push({ name: "founder", text: founder.text });
  const startup = readActiveStartup(db);
  sections.push({ name: "startup", text: startupSection(db) });

  const work = workSection(db);
  if (work) sections.push({ name: "work", text: work });

  const brief = latestBrief(db);
  if (brief) {
    sections.push({
      name: "brief",
      text: `## Startup brief (version ${brief.version}, ${brief.createdAt.slice(0, 10)})\nYour own running summary of the company. It can lag behind the lists above and below.\n\n${truncateToTokens(brief.content, BUDGETS.brief)}`,
    });
  }

  const memory = memorySection(retrieve(db, intent));
  if (memory.text) sections.push({ name: "memory", text: memory.text });

  if (intent.recall) {
    const recall = recallSection(db, conversation?.id ?? null);
    if (recall) sections.push({ name: "recall", text: recall });
  }
  if (conversation?.summary) {
    sections.push({ name: "summary", text: truncateToTokens(`## Earlier in this conversation\n${conversation.summary}`, BUDGETS.summary) });
  }

  const guidance = [MODE_GUIDANCE[intent.mode]];
  if (!startup && founder.filledFields < SPARSE_FOUNDER_FIELDS) {
    guidance.push(
      "You are still getting to know the founder. Answer what they ask, and also weave in one or two natural discovery questions (interests, skills, resources, constraints, problems they've noticed). Never ask more than two questions at once, and never present a questionnaire.",
    );
  }
  if (intent.wantsPlan) guidance.push(PLAN_GUIDANCE);
  if (memory.text) guidance.push(CITE_RULE);
  sections.push({ name: "guidance", text: `## This conversation\n${guidance.join("\n")}` });

  const history = historyWindow(conversation, stored);
  const system = sections.map((s) => s.text).join("\n\n");

  const refs: BuiltContext["refs"] = {};
  const items: TraceItem[] = memory.used.map((r) => {
    const ref = refFor(r.item.id);
    refs[ref] = { id: r.item.id, kind: r.item.kind, title: r.item.title };
    return { ref, id: r.item.id, kind: KIND_LABELS[r.item.kind].singular, title: r.item.title, status: r.item.status, reason: r.reason };
  });

  const sectionTokens = sections.map((s) => ({ name: s.name, tokens: estimateTokens(s.text) }));
  const historyTokens = history.reduce((n, m) => n + estimateTokens(m.content), 0);
  sectionTokens.push({ name: "history", tokens: historyTokens });

  return {
    system,
    messages: history,
    refs,
    trace: {
      intent,
      sections: sectionTokens,
      items,
      historyMessages: history.length,
      summarizedMessages: conversation?.summaryCount ?? 0,
      briefVersion: brief?.version ?? null,
      totalTokens: sectionTokens.reduce((n, s) => n + s.tokens, 0),
    },
  };
}

/** System prompt for a conversation-less context (tests, evals): REVIEW mode, everything relevant. */
export function buildSystemPrompt(db: Db, intent?: Partial<Intent>): string {
  const startup = readActiveStartup(db);
  const base: Intent = { mode: startup ? "REVIEW" : "DISCOVER", kinds: [], keywords: [], recall: false, wantsPlan: false, source: "fallback", ...intent };
  return buildContext(db, { conversation: null, stored: [], intent: base }).system;
}

