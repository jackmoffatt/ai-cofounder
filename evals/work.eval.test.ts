import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { buildSystemPrompt } from "@/agent/contextBuilder";
import { extractMemory } from "@/agent/extraction";
import { planFromReply } from "@/agent/planning";
import { createDb, type Db } from "@/db/client";
import { listItems } from "@/db/queries/memory";
import { AnthropicProvider } from "@/services/ai/anthropic";
import { modelFor } from "@/services/ai/models";
import { readFounder } from "@/services/memory/founder";
import { ingestCandidates } from "@/services/memory/ingest";
import { acceptProposal, createProposal } from "@/services/memory/proposals";
import { readActiveStartup } from "@/services/memory/startup";
import { createTask, listTaskViews } from "@/services/work/tasks";
import { listExperimentRows } from "@/db/queries/work";
import { validatePlan } from "@/services/work/plan";

/** Real-model checks for tasks and plans. Opt-in: `npm run eval` (needs ANTHROPIC_API_KEY). */
const enabled = Boolean(process.env.ANTHROPIC_API_KEY);
const provider = new AnthropicProvider();
const TODAY = "2026-10-05"; // a Monday
const origin = { conversationId: "eval", messageId: "eval" };

let db: Db;
beforeEach(() => {
  db = createDb(":memory:");
});

async function run(message: string) {
  const { extraction, codes, taskCodes } = await extractMemory(provider, {
    db,
    today: TODAY,
    userMessage: message,
    lastAssistantMessage: null,
    knownName: readFounder(db).name,
    knownProfile: readFounder(db).profile,
    startup: readActiveStartup(db),
  });
  return ingestCandidates(db, extraction, codes, origin, taskCodes, TODAY);
}

describe.skipIf(!enabled)("tasks from conversation", () => {
  it("a stated commitment with a relative date becomes a dated task", async () => {
    await run("I need to email five students by Friday to set up interviews.");
    const [t] = listTaskViews(db, TODAY);
    expect(t).toBeDefined();
    expect(t.title.toLowerCase()).toContain("email");
    expect(t.dueDate).toBe("2026-10-09");
  });

  it("an explicit reminder request becomes a task", async () => {
    await run("Remind me to book the library room for Thursday's interviews.");
    expect(listTaskViews(db, TODAY).length).toBeGreaterThan(0);
  });

  it("musing is not a task", async () => {
    await run("Maybe it would be good at some point to email some students? Not sure yet.");
    expect(listTaskViews(db, TODAY)).toEqual([]);
  });

  it("an idea or a belief is not a task", async () => {
    await run("I think students would love a calendar plugin.");
    expect(listTaskViews(db, TODAY)).toEqual([]);
  });

  it("finishing an existing task updates that task", async () => {
    const t = createTask(db, { title: "Write the interview script", origin: "manual", createdBy: "user" }).task;
    await run("I finished writing the interview script this morning.");
    expect(listTaskViews(db, TODAY).find((x) => x.id === t.id)!.status).toBe("done");
  });

  it("does not mark a different task done", async () => {
    const t = createTask(db, { title: "Build the landing page", origin: "manual", createdBy: "user" }).task;
    await run("I finished writing the interview script this morning.");
    expect(listTaskViews(db, TODAY).find((x) => x.id === t.id)!.status).toBe("todo");
  });
});

describe.skipIf(!enabled)("validation plans", () => {
  it("a validation request yields a reply with the plan structure, and a valid, acceptable plan card", async () => {
    const message = "We need to validate that college students lose several hours a week coordinating study group schedules. I have about 5 hours a week and no budget.";
    const reply = await provider.complete({
      model: modelFor("chat"),
      system: buildSystemPrompt(db, { mode: "VALIDATE", wantsPlan: true }),
      messages: [{ role: "user", content: message }],
      maxTokens: 4000,
      effort: "medium",
    });
    console.log("\n" + reply.text);
    for (const heading of ["Objective", "Assumptions", "Experiments", "Tasks", "Success criteria"]) {
      expect(reply.text).toContain(heading);
    }

    const plan = await planFromReply(provider, db, { userMessage: message, reply: reply.text });
    expect(plan).not.toBeNull();
    expect(validatePlan(db, plan!)).toBeNull();
    expect(plan!.experiments.length).toBeGreaterThan(0);
    expect(plan!.tasks.length).toBeGreaterThanOrEqual(2);
    // Everything in the plan has to be small enough for the founder's stated time.
    expect(plan!.tasks.length).toBeLessThanOrEqual(12);

    const proposal = createProposal(db, plan!, { rationale: "eval" })!;
    expect(listTaskViews(db, TODAY)).toEqual([]); // nothing until accepted
    acceptProposal(db, proposal.id);
    expect(listExperimentRows(db).length).toBe(plan!.experiments.length);
    for (const a of listItems(db, { kind: "assumption" })) expect([a.status, a.confidence]).toEqual(["untested", "low"]);
  });

  it("small talk yields no plan", async () => {
    const plan = await planFromReply(provider, db, { userMessage: "Thanks, that makes sense.", reply: "Glad it helps. Let me know what you find." });
    expect(plan).toBeNull();
  });
});
