import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { runChatTurn, type TurnEvent } from "@/agent/chat";
import { workSection } from "@/agent/contextBuilder";
import { emptyExtraction, type Extraction } from "@/agent/extraction";
import { createDb, type Db } from "@/db/client";
import { getItem, listEvidence, listItems, listProposalRows } from "@/db/queries/memory";
import { getTaskRow, listExperimentRows, listObjectiveRows } from "@/db/queries/work";
import { FakeProvider } from "@/services/ai/fake";
import { renderStatusSections } from "@/services/brief";
import { ingestCandidates } from "@/services/memory/ingest";
import { createItem } from "@/services/memory/items";
import { acceptProposal, createProposal } from "@/services/memory/proposals";
import { establishStartup, readActiveStartup } from "@/services/memory/startup";
import { undoEvent } from "@/services/memory/undo";
import { completeExperiment, createExperiment, updateExperiment } from "@/services/work/experiments";
import { createObjective, currentObjective } from "@/services/work/objectives";
import { applyPlan, validatePlan, type PlanChange } from "@/services/work/plan";
import { WorkError, createTask, deleteTask, listTaskViews, setDependencies, updateTask } from "@/services/work/tasks";

let db: Db;
const TODAY = "2026-10-05";
const origin = { conversationId: "c1", messageId: "m1" };
beforeEach(() => {
  db = createDb(":memory:");
});

const task = (title: string, extra: Partial<Parameters<typeof createTask>[1]> = {}) =>
  createTask(db, { title, origin: "manual", createdBy: "user", ...extra }).task;

describe("tasks", () => {
  it("validates input and defaults sensibly", () => {
    expect(() => task("   ")).toThrow(WorkError);
    expect(() => task("x", { dueDate: "2026-02-31" })).toThrow(/due date/);
    expect(task("Email five students")).toMatchObject({ status: "todo", priority: "medium", category: "other", dueDate: null });
  });

  it("completing sets and clears completedAt, and is audited", () => {
    const t = task("Write script");
    expect(updateTask(db, t.id, { status: "done" }).completedAt).not.toBeNull();
    expect(updateTask(db, t.id, { status: "todo" }).completedAt).toBeNull();
    expect(() => updateTask(db, t.id, { status: "nope" as never })).toThrow(WorkError);
  });

  it("sorts by priority, then due date, and flags overdue", () => {
    task("low", { priority: "low" });
    task("high late", { priority: "high", dueDate: "2026-10-09" });
    task("high soon", { priority: "high", dueDate: "2026-10-03" });
    const views = listTaskViews(db, TODAY);
    expect(views.map((v) => v.title)).toEqual(["high soon", "high late", "low"]);
    expect(views[0].overdue).toBe(true);
    expect(views[1].overdue).toBe(false);
  });

  it("a task with an unfinished dependency is blocked until it is done", () => {
    const a = task("Write script");
    const b = task("Run interviews", { dependsOn: [a.id] });
    const blocked = listTaskViews(db, TODAY).find((v) => v.id === b.id)!;
    expect(blocked.effectiveStatus).toBe("blocked");
    expect(blocked.blockedBy).toEqual([{ id: a.id, title: "Write script" }]);
    updateTask(db, a.id, { status: "done" });
    expect(listTaskViews(db, TODAY).find((v) => v.id === b.id)!.effectiveStatus).toBe("todo");
  });

  it("rejects self-dependencies, unknown tasks and loops", () => {
    const a = task("A");
    const b = task("B", { dependsOn: [a.id] });
    const c = task("C", { dependsOn: [b.id] });
    expect(() => setDependencies(db, a.id, [a.id])).toThrow(/itself/);
    expect(() => setDependencies(db, a.id, ["nope"])).toThrow(/Unknown/);
    expect(() => setDependencies(db, a.id, [c.id])).toThrow(/loop/);
  });

  it("soft-deletes", () => {
    const t = task("Gone");
    expect(deleteTask(db, t.id)).toBe(true);
    expect(listTaskViews(db, TODAY)).toEqual([]);
    expect(getTaskRow(db, t.id)!.deletedAt).not.toBeNull();
  });
});

describe("experiments", () => {
  const assumption = () => createItem(db, { kind: "assumption", title: "Students struggle", origin: "manual", createdBy: "user" }).item;

  it("needs a real assumption and a hypothesis; running stamps the start date", () => {
    expect(() => createExperiment(db, { hypothesis: "h", assumptionId: "nope", createdBy: "user" })).toThrow(/assumption/);
    expect(() => createExperiment(db, { hypothesis: " ", createdBy: "user" })).toThrow(WorkError);
    const e = createExperiment(db, { hypothesis: "7 of 10 mention it", assumptionId: assumption().id, createdBy: "user" });
    expect(updateExperiment(db, e.id, { status: "running" }).startDate).not.toBeNull();
  });

  it("a result with a stance becomes evidence, and only then moves the assumption", () => {
    const a = assumption();
    const e = createExperiment(db, { hypothesis: "h", method: "10 interviews", assumptionId: a.id, createdBy: "user" });
    completeExperiment(db, e.id, { result: "3 of 10 mentioned it" });
    expect(listEvidence(db, a.id)).toEqual([]);
    expect(getItem(db, a.id)!.status).toBe("untested");

    const e2 = createExperiment(db, { hypothesis: "h2", method: "survey", assumptionId: a.id, createdBy: "user" });
    completeExperiment(db, e2.id, { result: "8 of 10 mentioned it", conclusion: "Real", evidence: { stance: "supports", strength: "strong" } });
    expect(listEvidence(db, a.id)).toHaveLength(1);
    expect(getItem(db, a.id)!.status).toBe("supported"); // one strong result: supported, never validated
    expect(() => completeExperiment(db, e2.id, { result: " " })).toThrow(/Say what happened/);
  });
});

describe("objectives", () => {
  it("newest active objective is current and updates the startup headline", () => {
    const s = establishStartup(db, "Acme");
    createObjective(db, { title: "First goal", createdBy: "user" });
    createObjective(db, { title: "Second goal", successCriteria: "10 interviews", createdBy: "user" });
    expect(currentObjective(db)!.title).toBe("Second goal");
    expect(readActiveStartup(db)!.currentObjective).toBe("Second goal");
    expect(s.id).toBeTruthy();
  });
});

const plan = (over: Partial<PlanChange> = {}): PlanChange => ({
  type: "plan",
  objective: { title: "Validate scheduling pain", description: "", successCriteria: "7 of 10" },
  assumptions: [{ itemId: null, title: "Students lose time to scheduling" }],
  experiments: [{ assumption: 0, hypothesis: "Most students find it painful", method: "10 interviews", successCriteria: "7 of 10" }],
  tasks: [
    { title: "Write script", description: "", category: "research", priority: "high", experiment: 0, dependsOn: [], dueInDays: 1 },
    { title: "Run interviews", description: "", category: "interview", priority: "high", experiment: 0, dependsOn: [0], dueInDays: 7 },
  ],
  ...over,
});

describe("plans", () => {
  it("validates structure", () => {
    expect(validatePlan(db, plan())).toBeNull();
    expect(validatePlan(db, plan({ objective: { title: " ", description: "", successCriteria: "" } }))).toBe("No objective");
    expect(validatePlan(db, plan({ tasks: [], experiments: [] }))).toBe("Nothing to do");
    expect(validatePlan(db, plan({ experiments: [{ assumption: 3, hypothesis: "h", method: "", successCriteria: "" }] }))).toBe("Bad experiment");
    const loop = plan().tasks.map((t, i) => ({ ...t, dependsOn: [1 - i] }));
    expect(validatePlan(db, plan({ tasks: loop }))).toBe("Dependency loop");
    expect(validatePlan(db, plan({ tasks: [{ ...plan().tasks[0], dependsOn: [0] }] }))).toBe("Bad dependency");
  });

  it("proposes without creating anything, and accepting creates it all, linked", () => {
    establishStartup(db, "Acme");
    const p = createProposal(db, plan(), { rationale: "r" })!;
    expect(p.summary).toBe("Plan: Validate scheduling pain · 1 experiment · 2 tasks");
    expect(listObjectiveRows(db)).toEqual([]);
    expect(listTaskViews(db, TODAY)).toEqual([]);

    acceptProposal(db, p.id);
    const objective = currentObjective(db)!;
    expect(readActiveStartup(db)!.currentObjective).toBe("Validate scheduling pain");
    const [exp] = listExperimentRows(db);
    expect(exp).toMatchObject({ objectiveId: objective.id, status: "planned" });
    const [a] = listItems(db, { kind: "assumption" });
    expect(a).toMatchObject({ title: "Students lose time to scheduling", status: "untested", confidence: "low" });
    expect(exp.assumptionId).toBe(a.id);

    const tasks = listTaskViews(db, TODAY);
    expect(tasks.map((t) => t.title).sort()).toEqual(["Run interviews", "Write script"]);
    const run = tasks.find((t) => t.title === "Run interviews")!;
    expect(run.effectiveStatus).toBe("blocked");
    expect(run.experimentId).toBe(exp.id);
    expect(tasks.find((t) => t.title === "Write script")!.dueDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("reuses an existing assumption instead of duplicating it", () => {
    const existing = createItem(db, { kind: "assumption", title: "Students lose time", origin: "manual", createdBy: "user" }).item;
    const p = createProposal(db, plan({ assumptions: [{ itemId: existing.id, title: "Students lose time" }] }), { rationale: "r" })!;
    acceptProposal(db, p.id);
    expect(listItems(db, { kind: "assumption" })).toHaveLength(1);
    expect(listExperimentRows(db)[0].assumptionId).toBe(existing.id);
  });

  it("is atomic: a failure part-way saves nothing", () => {
    // Bypass validation to force a loop at the dependency step, after everything else was created.
    const loop = plan().tasks.map((t, i) => ({ ...t, dependsOn: [1 - i] }));
    expect(() => applyPlan(db, plan({ tasks: loop }), { proposalId: "p" })).toThrow(/loop/);
    expect(listObjectiveRows(db)).toEqual([]);
    expect(listExperimentRows(db)).toEqual([]);
    expect(listTaskViews(db, TODAY)).toEqual([]);
    expect(listItems(db)).toEqual([]);
  });
});

const X = (p: Partial<Extraction>): Extraction => ({ ...emptyExtraction(), ...p });

describe("tasks from conversation", () => {
  const say = (title: string, dueDate: string | null = null) => X({ tasks: [{ title, dueDate, quote: "q" }] });

  it("creates the founder's commitments directly, attributed and undoable", () => {
    const { events } = ingestCandidates(db, say("Email five students", "2026-10-09"), new Map(), origin, new Map(), TODAY);
    const [t] = listTaskViews(db, TODAY);
    expect(t).toMatchObject({ title: "Email five students", dueDate: "2026-10-09", origin: "conversation", createdBy: "agent" });
    expect(events[0]).toMatchObject({ summary: "Task: Email five students" });
    expect(undoEvent(db, events[0].id)).toBe("undone");
    expect(listTaskViews(db, TODAY)).toEqual([]);
  });

  it("ignores past or invalid dates, duplicates, and caps per turn", () => {
    ingestCandidates(db, say("Book the room", "2020-01-01"), new Map(), origin, new Map(), TODAY);
    ingestCandidates(db, say("Book the room"), new Map(), origin, new Map(), TODAY);
    ingestCandidates(db, say("Call the dean", "not-a-date"), new Map(), origin, new Map(), TODAY);
    expect(listTaskViews(db, TODAY).map((t) => [t.title, t.dueDate])).toEqual([["Book the room", null], ["Call the dean", null]]);
    const many = X({ tasks: Array.from({ length: 8 }, (_, i) => ({ title: `Distinct task number ${i} here`, dueDate: null, quote: "q" })) });
    ingestCandidates(db, many, new Map(), origin, new Map(), TODAY);
    expect(listTaskViews(db, TODAY)).toHaveLength(2 + 3);
  });

  it("applies status updates to known tasks only, and undo restores the old status", () => {
    const t = task("Write script");
    const codes = new Map([["t1", { id: t.id }]]);
    const { events } = ingestCandidates(db, X({ taskUpdates: [{ target: "t1", status: "done", quote: "finished it" }, { target: "t9", status: "done", quote: "q" }] }), new Map(), origin, codes, TODAY);
    expect(getTaskRow(db, t.id)!.status).toBe("done");
    expect(events).toHaveLength(1);
    expect(undoEvent(db, events[0].id)).toBe("undone");
    expect(getTaskRow(db, t.id)!.status).toBe("todo");
  });

  it("does not revert a status the founder changed afterwards", () => {
    const t = task("Write script");
    const { events } = ingestCandidates(db, X({ taskUpdates: [{ target: "t1", status: "done", quote: "q" }] }), new Map(), origin, new Map([["t1", { id: t.id }]]), TODAY);
    updateTask(db, t.id, { status: "dropped" });
    undoEvent(db, events[0].id);
    expect(getTaskRow(db, t.id)!.status).toBe("dropped");
  });
});

describe("work in context and brief", () => {
  it("summarises objective, experiments and open tasks, with overdue and blocked flagged", () => {
    expect(workSection(db, TODAY)).toBeNull();
    createObjective(db, { title: "Validate scheduling pain", successCriteria: "7 of 10", createdBy: "user" });
    const a = task("Write script", { dueDate: "2026-10-01", priority: "high" });
    task("Run interviews", { dependsOn: [a.id] });
    createExperiment(db, { hypothesis: "Most find it painful", method: "10 interviews", createdBy: "user" });
    const w = workSection(db, TODAY)!;
    expect(w).toContain("Today is 2026-10-05");
    expect(w).toContain("Objective: Validate scheduling pain");
    expect(w).toContain("[planned] Most find it painful — 10 interviews");
    expect(w).toContain("Write script (todo · high · OVERDUE, due 2026-10-01)");
    expect(w).toContain('Run interviews (blocked · medium · blocked by "Write script")');
  });

  it("excludes finished tasks", () => {
    const t = task("Done thing");
    updateTask(db, t.id, { status: "done" });
    expect(workSection(db, TODAY)).toBeNull();
  });

  it("brief lists experiments and next tasks from the database", () => {
    task("Write script");
    createExperiment(db, { hypothesis: "Most find it painful", createdBy: "user" });
    const md = renderStatusSections(db);
    expect(md).toContain("## Active experiments");
    expect(md).toContain("## Next tasks");
  });
});

describe("a planning turn", () => {
  const dispatch = (planReturned: boolean) => (req: { system: string }) => {
    if (req.system.includes("You route one message")) return { mode: "VALIDATE", kinds: [], keywords: [], recall: false, wantsPlan: true };
    if (req.system.includes("convert a validation plan")) {
      return { plan: planReturned ? { ...plan(), assumptions: [{ target: null, title: "Students lose time" }] } : null };
    }
    return emptyExtraction();
  };
  async function turn(provider: FakeProvider, message: string) {
    const out: TurnEvent[] = [];
    for await (const e of runChatTurn({ db, provider }, { message })) out.push(e);
    return out;
  }

  it("turns the reply's plan into one pending card, and creates nothing until accepted", async () => {
    const provider = new FakeProvider({ structuredResult: dispatch(true) });
    const events = await turn(provider, "We need to validate that students lose time to scheduling");
    const card = events.find((e) => e.type === "proposals") as { proposals: Array<{ type: string; plan?: PlanChange }> };
    expect(card.proposals).toHaveLength(1);
    expect(card.proposals[0]).toMatchObject({ type: "plan" });
    expect(card.proposals[0].plan!.tasks).toHaveLength(2);
    expect(listTaskViews(db, TODAY)).toEqual([]);
    expect(listProposalRows(db, "pending")).toHaveLength(1);
  });

  it("asks the model for the structured plan guidance only when a plan was wanted", async () => {
    const provider = new FakeProvider({ structuredResult: dispatch(true) });
    await turn(provider, "We need to validate that students lose time to scheduling");
    const chat = provider.requests.find((r) => r.maxTokens === 32000)!;
    expect(chat.system).toContain("**Objective**");
    expect(chat.system).toContain("**Success criteria**");
  });

  it("makes no card when the reply contained no plan", async () => {
    const provider = new FakeProvider({ structuredResult: dispatch(false) });
    const events = await turn(provider, "We need to validate that students lose time to scheduling");
    expect(events.some((e) => e.type === "proposals")).toBe(false);
  });
});
