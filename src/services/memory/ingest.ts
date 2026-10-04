import type { Db } from "@/db/client";
import { getItem, listEventsForEntity, listEvidence } from "@/db/queries/memory";
import type { MemoryEvent, Proposal } from "@/db/schema";
import type { ItemKind } from "@/lib/memory";
import { STAGE_KEYS, STARTUP_FIELDS, type StageKey, type StartupFieldKey } from "@/lib/profile";
import { applyFounderCandidates, type Origin } from "./founder";
import { addEvidence, createItem, findDuplicate } from "./items";
import { createProposal, type ProposalChange } from "./proposals";
import { isValidDate, todayLocal } from "@/lib/work";
import { createTask, findDuplicateTask, updateTask } from "@/services/work/tasks";
import { getTaskRow } from "@/db/queries/work";
import { readActiveStartup } from "./startup";

/** Shape of validated model output (see agent/extraction.ts). Kept structural to avoid a dependency cycle. */
export interface Candidates {
  founder: Array<{ field: Parameters<typeof applyFounderCandidates>[1][number]["field"]; value: string; quote: string }>;
  items: Array<{ kind: Exclude<ItemKind, "note">; title: string; details: string; importance: number; quote: string }>;
  evidence: Array<{ target: string; stance: "supports" | "weakens"; strength: "anecdotal" | "moderate"; excerpt: string; quote: string }>;
  tasks: Array<{ title: string; dueDate: string | null; quote: string }>;
  taskUpdates: Array<{ target: string; status: "doing" | "done" | "dropped"; quote: string }>;
  proposals: Array<{
    type: Exclude<ProposalChange["type"], "plan">;
    field: string | null;
    value: string | null;
    target: string | null;
    rationale: string;
    quote: string;
  }>;
}

export const MAX_ITEMS_PER_TURN = 5;
export const MAX_EVIDENCE_PER_TURN = 4;
export const MAX_PROPOSALS_PER_TURN = 2;
export const MAX_TASKS_PER_TURN = 3;
export const MAX_TASK_UPDATES_PER_TURN = 3;

export interface IngestResult {
  events: MemoryEvent[];
  proposals: Proposal[];
}

/**
 * The write policy. Everything the model suggested is re-checked here, and only low-risk memory is
 * written directly:
 *  - new items always start at the kind's default status (assumptions: untested, low confidence)
 *  - evidence can only move an assumption through derived statuses, never to validated/rejected
 *  - anything that changes the startup's direction becomes a pending proposal
 */
export function ingestCandidates(
  db: Db,
  c: Candidates,
  codes: Map<string, { id: string }>,
  origin: Origin,
  taskCodes: Map<string, { id: string }> = new Map(),
  today: string = todayLocal(),
): IngestResult {
  const startup = readActiveStartup(db);
  const events: MemoryEvent[] = [];
  const proposals: Proposal[] = [];

  events.push(
    ...applyFounderCandidates(
      db,
      c.founder.map((f) => ({ field: f.field, value: f.value, evidence: f.quote })),
      origin,
    ),
  );

  for (const it of c.items.slice(0, MAX_ITEMS_PER_TURN)) {
    if (findDuplicate(db, it.kind, it.title)) continue;
    const { event } = createItem(db, {
      kind: it.kind,
      title: it.title,
      body: it.details,
      importance: it.importance,
      data:
        it.kind === "decision"
          ? { reasoning: it.details }
          : it.kind === "insight"
            ? { source: "founder-reported", observationCount: 1 }
            : {},
      origin: "conversation",
      originRef: { ...origin, quote: it.quote },
      createdBy: "agent",
      startupId: startup?.id ?? null,
      reason: it.quote,
    });
    events.push(event);
  }

  let evidenceCount = 0;
  for (const ev of c.evidence) {
    if (evidenceCount >= MAX_EVIDENCE_PER_TURN) break;
    const itemId = codes.get(ev.target)?.id;
    if (!itemId) continue;
    const item = getItem(db, itemId);
    if (!item || item.deletedAt || item.kind !== "assumption") continue;
    if (listEvidence(db, itemId).some((e) => e.excerpt.toLowerCase() === ev.excerpt.trim().toLowerCase())) continue;
    const { event } = addEvidence(db, {
      itemId,
      stance: ev.stance,
      strength: ev.strength,
      excerpt: ev.excerpt,
      origin: "conversation",
      originRef: { ...origin, quote: ev.quote },
      createdBy: "agent",
    });
    events.push(event);
    evidenceCount++;
  }

  // Tasks the founder commits to are low-risk and internal, so they are created directly (and are undoable).
  for (const t of c.tasks.slice(0, MAX_TASKS_PER_TURN)) {
    if (findDuplicateTask(db, t.title)) continue;
    const due = t.dueDate && isValidDate(t.dueDate) && t.dueDate >= today ? t.dueDate : null;
    const { event } = createTask(db, {
      title: t.title,
      dueDate: due,
      startupId: startup?.id ?? null,
      origin: "conversation",
      originRef: { ...origin, quote: t.quote },
      createdBy: "agent",
      reason: t.quote,
    });
    events.push(event);
  }

  let taskUpdates = 0;
  for (const u of c.taskUpdates) {
    if (taskUpdates >= MAX_TASK_UPDATES_PER_TURN) break;
    const id = taskCodes.get(u.target)?.id;
    const task = id ? getTaskRow(db, id) : undefined;
    if (!task || task.deletedAt || task.status === u.status) continue;
    updateTask(db, task.id, { status: u.status }, "agent", u.quote);
    const ev = listEventsForTask(db, task.id);
    if (ev) events.push(ev);
    taskUpdates++;
  }

  for (const p of c.proposals) {
    if (proposals.length >= MAX_PROPOSALS_PER_TURN) break;
    const change = toChange(p, codes);
    if (!change) continue;
    const row = createProposal(db, change, { rationale: p.rationale || p.quote, originRef: { ...origin, quote: p.quote } });
    if (row) proposals.push(row);
  }

  return { events, proposals };
}

function toChange(p: Candidates["proposals"][number], codes: Map<string, { id: string }>): ProposalChange | null {
  const value = p.value?.trim() ?? "";
  const itemId = p.target ? codes.get(p.target)?.id : undefined;
  switch (p.type) {
    case "startup_field": {
      const field = STARTUP_FIELDS.find((f) => f.key === p.field)?.key as StartupFieldKey | undefined;
      return field && value ? { type: "startup_field", field, value } : null;
    }
    case "stage":
      return STAGE_KEYS.includes(value as StageKey) ? { type: "stage", to: value as StageKey } : null;
    case "objective":
      return value ? { type: "objective", text: value } : null;
    case "assumption_status":
      return itemId && (value === "validated" || value === "rejected")
        ? { type: "assumption_status", itemId, to: value }
        : null;
    case "decision_supersede":
      return itemId && value ? { type: "decision_supersede", itemId, title: value, reasoning: p.rationale } : null;
  }
}

/** The audit event just written for a task, so the UI can offer undo. */
function listEventsForTask(db: Db, taskId: string): MemoryEvent | undefined {
  return listEventsForEntity(db, "task", taskId)[0];
}
