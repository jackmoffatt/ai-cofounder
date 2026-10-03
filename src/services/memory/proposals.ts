import type { Db } from "@/db/client";
import {
  getItem,
  getProposalRow,
  insertProposalRow,
  listEvidence,
  listProposalRows,
  updateProposalRow,
} from "@/db/queries/memory";
import { insertEvent } from "@/db/queries/profile";
import { LOCAL_OWNER, type Proposal } from "@/db/schema";
import { evidenceJustifies } from "@/lib/epistemics";
import { isValidStatus } from "@/lib/memory";
import { STAGE_KEYS, STARTUP_FIELDS, stageLabel, type StageKey, type StartupFieldKey } from "@/lib/profile";
import { createItem, updateItem } from "./items";
import { readActiveStartup, saveStartupEdit } from "./startup";

/** Payloads by proposal type. Stored as JSON in proposals.change. */
export type ProposalChange =
  | { type: "startup_field"; field: StartupFieldKey; value: string }
  | { type: "stage"; to: StageKey }
  | { type: "objective"; text: string }
  | { type: "assumption_status"; itemId: string; to: "validated" | "rejected" }
  | { type: "decision_supersede"; itemId: string; title: string; reasoning: string };

export class ProposalError extends Error {}

const FIELD_LABEL = Object.fromEntries(STARTUP_FIELDS.map((f) => [f.key, f.label])) as Record<StartupFieldKey, string>;

/** Human-readable one-liner; also what the founder sees on the card. */
export function describeChange(db: Db, c: ProposalChange): string {
  switch (c.type) {
    case "startup_field":
      return `Set ${FIELD_LABEL[c.field].toLowerCase()} to “${c.value}”`;
    case "stage":
      return `Move the startup to ${stageLabel(c.to)}`;
    case "objective":
      return `Set the current objective to “${c.text}”`;
    case "assumption_status": {
      const item = getItem(db, c.itemId);
      return `Mark “${item?.title ?? "assumption"}” as ${c.to}`;
    }
    case "decision_supersede":
      return `Replace a decision with “${c.title}”`;
  }
}

/**
 * Checks a proposed change against current state before it is even shown. Returns the reason it is
 * invalid, or null. This is where "the model suggested it" stops being enough.
 */
export function validateChange(db: Db, c: ProposalChange): string | null {
  switch (c.type) {
    case "startup_field":
      if (!readActiveStartup(db)) return "No startup established";
      if (!c.value.trim()) return "Empty value";
      return STARTUP_FIELDS.some((f) => f.key === c.field) ? null : "Unknown field";
    case "stage":
      if (!readActiveStartup(db)) return "No startup established";
      if (!STAGE_KEYS.includes(c.to)) return "Unknown stage";
      return readActiveStartup(db)!.stage === c.to ? "Already at that stage" : null;
    case "objective":
      if (!readActiveStartup(db)) return "No startup established";
      return c.text.trim() ? null : "Empty objective";
    case "assumption_status": {
      const item = getItem(db, c.itemId);
      if (!item || item.deletedAt || item.kind !== "assumption") return "Not an assumption";
      if (item.status === c.to) return "Already has that status";
      return evidenceJustifies(listEvidence(db, c.itemId), c.to) ? null : "Not enough evidence";
    }
    case "decision_supersede": {
      const item = getItem(db, c.itemId);
      if (!item || item.deletedAt || item.kind !== "decision" || item.status !== "active") return "Not an active decision";
      return c.title.trim() ? null : "Empty decision";
    }
  }
}

/** Creates a pending proposal, unless an identical one is already pending or was already declined. */
export function createProposal(
  db: Db,
  change: ProposalChange,
  info: { rationale: string; originRef?: Record<string, unknown> },
): Proposal | null {
  if (validateChange(db, change)) return null;
  const payload = JSON.stringify(change);
  if (listProposalRows(db).some((p) => p.change === payload && p.status !== "accepted")) return null;
  const row: Proposal = {
    id: crypto.randomUUID(),
    ownerId: LOCAL_OWNER,
    type: change.type,
    change: payload,
    summary: describeChange(db, change),
    rationale: info.rationale.slice(0, 500),
    status: "pending",
    originRef: JSON.stringify(info.originRef ?? {}),
    createdAt: new Date().toISOString(),
    decidedAt: null,
  };
  insertProposalRow(db, row);
  return row;
}

function apply(db: Db, c: ProposalChange, reason: string): void {
  const startup = readActiveStartup(db);
  switch (c.type) {
    case "startup_field":
      saveStartupEdit(db, startup!.id, { profile: { [c.field]: c.value } });
      break;
    case "stage":
      saveStartupEdit(db, startup!.id, { stage: c.to });
      break;
    case "objective":
      saveStartupEdit(db, startup!.id, { currentObjective: c.text });
      break;
    case "assumption_status":
      if (!isValidStatus("assumption", c.to)) throw new ProposalError("Invalid status");
      updateItem(db, c.itemId, { status: c.to }, "user", reason);
      break;
    case "decision_supersede": {
      const old = getItem(db, c.itemId)!;
      updateItem(db, c.itemId, { status: "superseded" }, "user", reason);
      createItem(db, {
        kind: "decision",
        title: c.title,
        body: c.reasoning,
        data: { reasoning: c.reasoning },
        origin: "manual",
        createdBy: "user",
        startupId: old.startupId,
        supersedesId: old.id,
        reason,
      });
      break;
    }
  }
}

export function acceptProposal(db: Db, id: string): Proposal {
  const p = getProposalRow(db, id);
  if (!p) throw new ProposalError("Not found");
  if (p.status !== "pending") throw new ProposalError(`Already ${p.status}`);
  const change = JSON.parse(p.change) as ProposalChange;
  const invalid = validateChange(db, change);
  if (invalid) throw new ProposalError(`This no longer applies: ${invalid.toLowerCase()}`);
  apply(db, change, `Accepted proposal: ${p.summary}`);
  updateProposalRow(db, id, { status: "accepted", decidedAt: new Date().toISOString() });
  insertEvent(db, {
    entityType: "proposal",
    entityId: id,
    action: "update",
    actor: "user",
    summary: `Accepted: ${p.summary}`,
    reason: p.rationale,
  });
  return getProposalRow(db, id)!;
}

export function rejectProposal(db: Db, id: string): Proposal {
  const p = getProposalRow(db, id);
  if (!p) throw new ProposalError("Not found");
  if (p.status !== "pending") throw new ProposalError(`Already ${p.status}`);
  updateProposalRow(db, id, { status: "rejected", decidedAt: new Date().toISOString() });
  insertEvent(db, {
    entityType: "proposal",
    entityId: id,
    action: "update",
    actor: "user",
    summary: `Declined: ${p.summary}`,
    reason: "",
  });
  return getProposalRow(db, id)!;
}

export { listProposalRows };
