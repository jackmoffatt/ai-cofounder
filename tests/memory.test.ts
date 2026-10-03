import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { runChatTurn, type TurnEvent } from "@/agent/chat";
import { emptyExtraction, extractMemory, type Extraction } from "@/agent/extraction";
import { createDb, type Db } from "@/db/client";
import { getItem, listEvidence, listItems, listProposalRows } from "@/db/queries/memory";
import { getEvent } from "@/db/queries/profile";
import { FakeProvider } from "@/services/ai/fake";
import { ingestCandidates, MAX_ITEMS_PER_TURN } from "@/services/memory/ingest";
import { addEvidence, createItem, deleteItem, restoreItem, updateItem, MemoryError } from "@/services/memory/items";
import { acceptProposal, createProposal, rejectProposal, ProposalError } from "@/services/memory/proposals";
import { establishStartup, readActiveStartup, saveStartupEdit } from "@/services/memory/startup";
import { undoEvent } from "@/services/memory/undo";

let db: Db;
const origin = { conversationId: "c1", messageId: "m1" };
const noCodes = new Map<string, { id: string }>();
beforeEach(() => {
  db = createDb(":memory:");
});

const X = (p: Partial<Extraction>): Extraction => ({ ...emptyExtraction(), ...p });
const assumption = (title: string, importance = 4) => ({ kind: "assumption" as const, title, details: "", importance, quote: "q" });

describe("fact vs assumption", () => {
  it("stores a claim as an untested, low-confidence assumption, not a fact", () => {
    ingestCandidates(db, X({ items: [assumption("College students struggle with scheduling")] }), noCodes, origin);
    const [item] = listItems(db);
    expect(item).toMatchObject({
      kind: "assumption",
      title: "College students struggle with scheduling",
      status: "untested",
      confidence: "low",
      createdBy: "agent",
      origin: "conversation",
    });
    expect(listEvidence(db, item.id)).toEqual([]);
  });

  it("forces untested/low even when someone creates an assumption directly", () => {
    const { item } = createItem(db, { kind: "assumption", title: "X is true", origin: "manual", createdBy: "user" });
    expect([item.status, item.confidence]).toEqual(["untested", "low"]);
  });

  it("moves an assumption only through evidence: 7 of 10 interviews", () => {
    ingestCandidates(db, X({ items: [assumption("Students struggle with X")] }), noCodes, origin);
    const [item] = listItems(db);
    const codes = new Map([["i1", { id: item.id }]]);
    const ev = (n: number) => ({
      target: "i1",
      stance: "supports" as const,
      strength: "moderate" as const,
      excerpt: `interview ${n}: mentioned X`,
      quote: "q",
    });

    ingestCandidates(db, X({ evidence: [ev(1)] }), codes, origin);
    expect(getItem(db, item.id)).toMatchObject({ status: "testing", confidence: "low" });

    ingestCandidates(db, X({ evidence: [ev(2), ev(3), ev(4)] }), codes, origin);
    expect(getItem(db, item.id)).toMatchObject({ status: "supported", confidence: "high" });
    // Even with strong support the model cannot make it validated: that needs a human.
    expect(getItem(db, item.id)!.status).not.toBe("validated");
  });

  it("ignores evidence pointing at unknown codes or non-assumptions", () => {
    const { item: q } = createItem(db, { kind: "question", title: "Who pays?", origin: "manual", createdBy: "user" });
    ingestCandidates(
      db,
      X({
        evidence: [
          { target: "nope", stance: "supports", strength: "moderate", excerpt: "e", quote: "q" },
          { target: "i1", stance: "supports", strength: "moderate", excerpt: "e", quote: "q" },
        ],
      }),
      new Map([["i1", { id: q.id }]]),
      origin,
    );
    expect(listEvidence(db, q.id)).toEqual([]);
  });

  it("skips duplicates and caps items per turn", () => {
    ingestCandidates(db, X({ items: [assumption("Students struggle with scheduling")] }), noCodes, origin);
    ingestCandidates(db, X({ items: [assumption("students struggle with scheduling.")] }), noCodes, origin);
    expect(listItems(db)).toHaveLength(1);

    const many = Array.from({ length: 9 }, (_, i) => assumption(`Distinct claim number ${i} about users`));
    ingestCandidates(db, X({ items: many }), noCodes, origin);
    expect(listItems(db)).toHaveLength(1 + MAX_ITEMS_PER_TURN);
  });

  it("records provenance: source quote, conversation and an audit event", () => {
    const { events } = ingestCandidates(
      db,
      X({ items: [{ ...assumption("Claim"), quote: "I think so" }] }),
      noCodes,
      origin,
    );
    const [item] = listItems(db);
    expect(JSON.parse(item.originRef)).toMatchObject({ conversationId: "c1", messageId: "m1", quote: "I think so" });
    expect(events[0]).toMatchObject({ actor: "agent", reason: "I think so", entityId: item.id });
  });
});

describe("proposals (strategic changes need confirmation)", () => {
  const targetCustomer = (value: string) =>
    X({ proposals: [{ type: "startup_field", field: "targetCustomer", value, target: null, rationale: "You said so", quote: "q" }] });

  it("never changes the startup directly; creates a pending proposal", () => {
    const s = establishStartup(db, "Acme");
    const { proposals } = ingestCandidates(db, targetCustomer("bootcamp students"), noCodes, origin);
    expect(proposals).toHaveLength(1);
    expect(proposals[0]).toMatchObject({ status: "pending", summary: "Set target customer to “bootcamp students”" });
    expect(readActiveStartup(db)!.profile.targetCustomer).toBeUndefined();
    expect(s.id).toBeTruthy();
  });

  it("drops startup proposals when no startup exists", () => {
    const { proposals } = ingestCandidates(db, targetCustomer("anyone"), noCodes, origin);
    expect(proposals).toEqual([]);
  });

  it("applies on accept, with an audit trail", () => {
    establishStartup(db, "Acme");
    const { proposals } = ingestCandidates(db, targetCustomer("bootcamp students"), noCodes, origin);
    expect(acceptProposal(db, proposals[0].id).status).toBe("accepted");
    expect(readActiveStartup(db)!.profile.targetCustomer).toBe("bootcamp students");
    expect(() => acceptProposal(db, proposals[0].id)).toThrow(ProposalError);
  });

  it("does not apply on reject and does not re-propose the same thing", () => {
    establishStartup(db, "Acme");
    const { proposals } = ingestCandidates(db, targetCustomer("bootcamp students"), noCodes, origin);
    rejectProposal(db, proposals[0].id);
    expect(readActiveStartup(db)!.profile.targetCustomer).toBeUndefined();
    expect(ingestCandidates(db, targetCustomer("bootcamp students"), noCodes, origin).proposals).toEqual([]);
    expect(ingestCandidates(db, targetCustomer("freelancers"), noCodes, origin).proposals).toHaveLength(1);
  });

  it("proposes stage changes and refuses no-ops", () => {
    establishStartup(db, "Acme");
    const stage = (v: string) => X({ proposals: [{ type: "stage", field: null, value: v, target: null, rationale: "r", quote: "q" }] });
    expect(ingestCandidates(db, stage("discovery"), noCodes, origin).proposals).toEqual([]); // already there
    expect(ingestCandidates(db, stage("warp_speed"), noCodes, origin).proposals).toEqual([]); // unknown
    const { proposals } = ingestCandidates(db, stage("validation"), noCodes, origin);
    acceptProposal(db, proposals[0].id);
    expect(readActiveStartup(db)!.stage).toBe("validation");
  });

  it("only proposes validating/rejecting an assumption when the evidence justifies it", () => {
    const { item } = createItem(db, { kind: "assumption", title: "Students struggle", origin: "manual", createdBy: "user" });
    const codes = new Map([["i1", { id: item.id }]]);
    const validate = X({ proposals: [{ type: "assumption_status", field: null, value: "validated", target: "i1", rationale: "r", quote: "q" }] });

    expect(ingestCandidates(db, validate, codes, origin).proposals).toEqual([]); // no evidence

    for (let i = 0; i < 3; i++) {
      addEvidence(db, { itemId: item.id, stance: "supports", strength: "moderate", excerpt: `obs ${i}`, origin: "manual", createdBy: "user" });
    }
    const { proposals } = ingestCandidates(db, validate, codes, origin);
    expect(proposals).toHaveLength(1);
    expect(getItem(db, item.id)!.status).toBe("supported"); // still not validated until accepted
    acceptProposal(db, proposals[0].id);
    expect(getItem(db, item.id)!.status).toBe("validated");
  });

  it("replaces an active decision only on accept, keeping the old one as superseded", () => {
    const { item: old } = createItem(db, { kind: "decision", title: "Target freshmen", origin: "manual", createdBy: "user" });
    const p = createProposal(db, { type: "decision_supersede", itemId: old.id, title: "Target seniors", reasoning: "Better access" }, { rationale: "r" })!;
    expect(getItem(db, old.id)!.status).toBe("active");
    acceptProposal(db, p.id);
    expect(getItem(db, old.id)!.status).toBe("superseded");
    const next = listItems(db, { kind: "decision" }).find((d) => d.title === "Target seniors")!;
    expect(next).toMatchObject({ status: "active", supersedesId: old.id });
  });

  it("refuses to accept a proposal that no longer applies", () => {
    const startup = establishStartup(db, "Acme");
    const p = createProposal(db, { type: "stage", to: "validation" }, { rationale: "r" })!;
    saveStartupEdit(db, startup.id, { stage: "validation" }); // founder got there first
    expect(() => acceptProposal(db, p.id)).toThrow(/no longer applies/);
    expect(listProposalRows(db, "pending")).toHaveLength(1); // left pending, not silently applied
  });
});

describe("editing, deleting and undoing", () => {
  it("validates statuses per kind and audits user edits", () => {
    const { item } = createItem(db, { kind: "decision", title: "D", origin: "manual", createdBy: "user" });
    expect(() => updateItem(db, item.id, { status: "validated" })).toThrow(MemoryError);
    const updated = updateItem(db, item.id, { status: "reversed", body: "Changed our mind" });
    expect(updated).toMatchObject({ status: "reversed", body: "Changed our mind" });
  });

  it("soft-deletes, hides from lists, and can be restored", () => {
    const { item } = createItem(db, { kind: "idea", title: "I", origin: "manual", createdBy: "user" });
    expect(deleteItem(db, item.id)).toBe(true);
    expect(listItems(db)).toEqual([]);
    expect(getItem(db, item.id)!.deletedAt).not.toBeNull();
    restoreItem(db, item.id);
    expect(listItems(db)).toHaveLength(1);
    expect(deleteItem(db, "missing")).toBe(false);
  });

  it("undo of an agent-created item hides it; undo of agent evidence recomputes the status", () => {
    const { events } = ingestCandidates(db, X({ items: [assumption("Claim A")] }), noCodes, origin);
    const [item] = listItems(db);
    const evEvents = ingestCandidates(
      db,
      X({ evidence: [{ target: "i1", stance: "supports", strength: "moderate", excerpt: "saw it", quote: "q" }] }),
      new Map([["i1", { id: item.id }]]),
      origin,
    ).events;
    expect(getItem(db, item.id)!.status).toBe("testing");

    expect(undoEvent(db, evEvents[0].id)).toBe("undone");
    expect(getItem(db, item.id)).toMatchObject({ status: "untested", confidence: "low" });
    expect(listEvidence(db, item.id)).toEqual([]);

    expect(undoEvent(db, events[0].id)).toBe("undone");
    expect(listItems(db)).toEqual([]);
    expect(undoEvent(db, events[0].id)).toBe("already_undone");
    expect(getEvent(db, events[0].id)!.undoneAt).not.toBeNull();
  });

  it("will not undo events the founder made themselves", () => {
    const { event } = createItem(db, { kind: "idea", title: "Mine", origin: "manual", createdBy: "user" });
    expect(undoEvent(db, event.id)).toBe("unsupported");
  });
});

describe("through a chat turn", () => {
  async function turn(provider: FakeProvider, message: string, conversationId?: string) {
    const out: TurnEvent[] = [];
    for await (const e of runChatTurn({ db, provider }, { message, conversationId })) out.push(e);
    return out;
  }

  it("turns a founder's claim into an untested assumption and reports it with a link", async () => {
    const provider = new FakeProvider({ structuredResult: X({ items: [{ ...assumption("College students struggle with X"), quote: "students struggle with X" }] }) });
    const events = await turn(provider, "I believe college students struggle with X");
    const mem = events.find((e) => e.type === "memory");
    const [item] = listItems(db);
    expect(item).toMatchObject({ status: "untested", confidence: "low" });
    expect(mem).toMatchObject({ changes: [{ summary: "Assumption: College students struggle with X", itemId: item.id }] });
  });

  it("emits a proposal card, persists its id on the reply, and changes nothing until accepted", async () => {
    establishStartup(db, "Acme");
    const provider = new FakeProvider({
      structuredResult: X({ proposals: [{ type: "startup_field", field: "problem", value: "Scheduling is painful", target: null, rationale: "You said it", quote: "scheduling" }] }),
    });
    const events = await turn(provider, "I think scheduling is the real problem");
    const card = events.find((e) => e.type === "proposals");
    expect(card).toMatchObject({ proposals: [{ status: "pending", type: "startup_field" }] });
    expect(readActiveStartup(db)!.profile.problem).toBeUndefined();
  });

  it("drops model output whose quote is not in the founder's message", async () => {
    const provider = new FakeProvider({ structuredResult: X({ items: [{ ...assumption("Invented claim"), quote: "never said this" }] }) });
    await turn(provider, "hello there");
    expect(listItems(db)).toEqual([]);
  });
});

describe("extractMemory request", () => {
  it("shows the model existing memory by short code", async () => {
    createItem(db, { kind: "assumption", title: "Students struggle", origin: "manual", createdBy: "user" });
    const provider = new FakeProvider({ structuredResult: emptyExtraction() });
    const { codes } = await extractMemory(provider, { db, userMessage: "hi", lastAssistantMessage: null, knownName: null, knownProfile: {}, startup: null });
    expect(codes.get("i1")).toBeDefined();
    expect(provider.requests[0].messages[0].content).toContain("i1 | assumption | untested | Students struggle");
  });
});
