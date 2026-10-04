import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { z } from "zod";
import { classifyIntent } from "@/agent/intent";
import { createDb, type Db } from "@/db/client";
import { AnthropicProvider } from "@/services/ai/anthropic";
import { modelFor } from "@/services/ai/models";
import { generateBrief } from "@/services/brief";
import { addEvidence, createItem, updateItem } from "@/services/memory/items";
import { establishStartup, saveStartupEdit } from "@/services/memory/startup";

/** Real-model checks for the context layer. Opt-in: `npm run eval` (needs ANTHROPIC_API_KEY). */
const enabled = Boolean(process.env.ANTHROPIC_API_KEY);
const provider = new AnthropicProvider();

let db: Db;
beforeEach(() => {
  db = createDb(":memory:");
});

describe.skipIf(!enabled)("intent routing", () => {
  const cases: Array<{ message: string; mode: string[]; recall?: boolean }> = [
    { message: "What should I work on tonight?", mode: ["REVIEW"] },
    { message: "Where were we on the pricing discussion?", mode: ["REVIEW", "STRATEGY"], recall: true },
    { message: "Who are our main competitors and what do they charge?", mode: ["RESEARCH"] },
    { message: "How can I test whether students would actually pay for this?", mode: ["VALIDATE"] },
    { message: "I'm a junior in college, I like sports analytics and I'm not sure what to build. Where do I start?", mode: ["DISCOVER"] },
    { message: "Why did we decide to target freshmen?", mode: ["REVIEW", "STRATEGY"], recall: true },
    { message: "Draft a cold email to recruit interview participants", mode: ["GROW", "VALIDATE"] },
  ];
  for (const c of cases) {
    it(c.message, async () => {
      const r = await classifyIntent(provider, { message: c.message, previousMode: null, stage: null });
      expect(r.source).toBe("model");
      expect(c.mode).toContain(r.mode);
      if (c.recall !== undefined) expect(r.recall).toBe(c.recall);
    });
  }
});

const Judgement = z.object({
  statesUntestedAssumptionAsFact: z.boolean(),
  inventsFactsOrNumbers: z.boolean(),
});

describe.skipIf(!enabled)("startup brief honesty", () => {
  it("never states untested beliefs as fact, and invents nothing", async () => {
    const s = establishStartup(db, "CampusSync");
    saveStartupEdit(db, s.id, {
      stage: "validation",
      currentObjective: "Interview 10 students",
      profile: {
        problem: "Students waste hours coordinating study group schedules",
        targetCustomer: "College students in group-heavy majors",
        solution: "A scheduling app that finds common free time",
      },
    });
    const a = createItem(db, { kind: "assumption", title: "College students lose several hours a week coordinating study groups", importance: 5, origin: "manual", createdBy: "user" }).item;
    createItem(db, { kind: "assumption", title: "Students would pay $5 a month for this", importance: 4, origin: "manual", createdBy: "user" });
    addEvidence(db, { itemId: a.id, stance: "supports", strength: "anecdotal", excerpt: "One student said it takes her an hour a week", origin: "manual", createdBy: "user" });
    createItem(db, { kind: "question", title: "Do existing calendar tools already solve this?", importance: 4, origin: "manual", createdBy: "user" });

    const brief = await generateBrief(db, provider, "manual");
    expect(brief).not.toBeNull();
    console.log("\n" + brief!.content);

    const { data } = await provider.structured(
      {
        model: modelFor("extract"),
        system:
          "You audit a startup brief for epistemic honesty. The only established fact is what is explicitly labelled validated; here NOTHING is validated. Judge strictly and literally.",
        messages: [
          {
            role: "user",
            content: `Beliefs that are NOT established: students lose several hours a week coordinating study groups; students would pay $5 a month; the problem is real and widespread.\n\nBrief narrative:\n${brief!.content.split("## Assumptions")[0]}\n\nDoes the narrative state any of those beliefs as established fact (rather than as a belief, assumption or claim by the founder)? Does it invent specific facts, numbers, competitors or sources not in: stage validation, objective "Interview 10 students", one anecdote of an hour a week?`,
          },
        ],
        maxTokens: 400,
      },
      Judgement,
    );
    expect(data.statesUntestedAssumptionAsFact).toBe(false);
    expect(data.inventsFactsOrNumbers).toBe(false);
    expect(brief!.content).toContain("## Recommended next action");
  });

  it("only lists validated assumptions as established", async () => {
    const a = createItem(db, { kind: "assumption", title: "Claim A", importance: 4, origin: "manual", createdBy: "user" }).item;
    const b = createItem(db, { kind: "assumption", title: "Claim B", importance: 4, origin: "manual", createdBy: "user" }).item;
    updateItem(db, b.id, { status: "validated" });
    const brief = await generateBrief(db, provider, "manual");
    const established = brief!.content.split("## Established (validated by the founder)")[1]?.split("\n## ")[0] ?? "";
    expect(established).toContain("Claim B");
    expect(established).not.toContain("Claim A");
    expect(a.id).toBeTruthy();
  });
});
