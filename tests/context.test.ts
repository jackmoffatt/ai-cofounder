import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { runChatTurn, type TurnEvent } from "@/agent/chat";
import { buildSystemPrompt } from "@/agent/contextBuilder";
import { emptyExtraction, extractMemory, type Extraction } from "@/agent/extraction";
import { createDb, type Db } from "@/db/client";
import { listMessages } from "@/db/queries/conversations";
import { getEvent } from "@/db/queries/profile";
import { FakeProvider } from "@/services/ai/fake";
import { addEvidence, createItem, deleteItem } from "@/services/memory/items";
import { readFounder, saveFounderEdit, undoFounderEvent } from "@/services/memory/founder";
import { establishStartup, saveStartupEdit } from "@/services/memory/startup";

let db: Db;
beforeEach(() => {
  db = createDb(":memory:");
});

async function collect(gen: AsyncGenerator<TurnEvent>) {
  const out: TurnEvent[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

describe("buildSystemPrompt", () => {
  it("leans into discovery when we know little and there is no startup", () => {
    const p = buildSystemPrompt(db);
    expect(p).toContain("You know nothing about the founder yet");
    expect(p).toContain("No startup has been established");
    expect(p).toContain("discovery questions");
  });

  it("includes founder facts and drops the discovery nudge once the profile is richer", () => {
    saveFounderEdit(db, {
      name: "Jack",
      profile: {
        skills: ["Python", "SQL"],
        constraints: ["10 hours a week", "no budget"],
        interests: ["education"],
      },
    });
    const p = buildSystemPrompt(db);
    expect(p).toContain("Name: Jack");
    expect(p).toContain("Skills: Python; SQL");
    expect(p).toContain("Constraints: 10 hours a week; no budget");
    expect(p).not.toContain("discovery questions");
  });

  it("labels startup details as unverified founder statements", () => {
    const s = establishStartup(db, "Acme");
    saveStartupEdit(db, s.id, {
      stage: "validation",
      currentObjective: "Interview 10 students",
      profile: { problem: "Students waste time scheduling" },
    });
    const p = buildSystemPrompt(db);
    expect(p).toContain("Stage: Validation");
    expect(p).toContain("Current objective: Interview 10 students");
    expect(p).toContain("Problem: Students waste time scheduling");
    expect(p).toContain("not verified facts");
    expect(p).not.toContain("No startup has been established");
  });
});

const X = (p: Partial<Extraction>): Extraction => ({ ...emptyExtraction(), ...p });
const founderExt = (field: string, value: string, quote: string) =>
  X({ founder: [{ field: field as never, value, quote }] });

describe("memory in the prompt", () => {
  it("lists assumptions with their epistemic status, and omits closed or deleted items", () => {
    const { item } = createItem(db, { kind: "assumption", title: "Students struggle", origin: "manual", createdBy: "user" });
    createItem(db, { kind: "decision", title: "Target seniors", origin: "manual", createdBy: "user" });
    const { item: gone } = createItem(db, { kind: "idea", title: "Dropped idea", origin: "manual", createdBy: "user" });
    deleteItem(db, gone.id);
    addEvidence(db, { itemId: item.id, stance: "supports", strength: "anecdotal", excerpt: "one student said so", origin: "manual", createdBy: "user" });

    const p = buildSystemPrompt(db, { mode: "REVIEW" });
    expect(p).toMatch(/- \[m:[0-9a-f]{8}\] Students struggle \(assumption · testing · low confidence · 1 piece of evidence\)/);
    expect(p).toMatch(/- \[m:[0-9a-f]{8}\] Target seniors \(decision · active\)/);
    expect(p).not.toContain("Dropped idea");
    expect(p).toContain("not a fact");
  });

  it("adds nothing when memory is empty", () => {
    expect(buildSystemPrompt(db)).not.toContain("Relevant recorded knowledge");
  });
});

describe("extractMemory", () => {
  const ctx = (userMessage: string) => ({
    db,
    userMessage,
    lastAssistantMessage: null,
    knownName: null,
    knownProfile: {},
    startup: null,
  });

  it("keeps updates whose quote is in the message and drops the rest", async () => {
    const provider = new FakeProvider({
      structuredResult: X({
        founder: [
          { field: "skills", value: "writes Python daily", quote: "I write Python daily" },
          { field: "skills", value: "expert in Rust", quote: "I am a Rust expert" },
          { field: "name", value: "Jack", quote: "I'm Jack" },
        ],
      }),
    });
    const { extraction } = await extractMemory(provider, ctx("I'm Jack and I write Python daily."));
    expect(extraction.founder.map((u) => u.value)).toEqual(["writes Python daily", "Jack"]);
  });

  it("returns nothing, without throwing, when the provider fails", async () => {
    const provider = new FakeProvider({ failWith: new Error("boom") });
    const { extraction } = await extractMemory(provider, ctx("hello"));
    expect(extraction).toEqual(emptyExtraction());
  });

  it("tells the model what is already known so it can skip it", async () => {
    const provider = new FakeProvider({ structuredResult: emptyExtraction() });
    await extractMemory(provider, { ...ctx("hi"), knownName: "Jack", knownProfile: { skills: ["SQL"] } });
    expect(provider.requests[0].messages[0].content).toContain("skills: SQL");
    expect(provider.requests[0].messages[0].content).toContain("name: Jack");
  });
});

describe("chat turn with memory", () => {
  const structuredResult = founderExt("constraints", "10 hours a week", "only have 10 hours a week");

  it("saves founder facts, reports them, and persists a note on the reply", async () => {
    const provider = new FakeProvider({ structuredResult });
    const events = await collect(runChatTurn({ db, provider }, { message: "I only have 10 hours a week" }));
    // `Updating memory…` follows `done`, so the UI is usable while memory is written.
    const types = events.map((e) => e.type);
    expect(types.indexOf("done")).toBeLessThan(types.indexOf("memory"));
    const mem = events.find((e) => e.type === "memory");
    expect(mem).toMatchObject({ changes: [{ summary: "Constraints: 10 hours a week" }] });

    expect(readFounder(db).profile.constraints).toEqual(["10 hours a week"]);
    const id = (events[0] as { conversationId: string }).conversationId;
    const reply = listMessages(db, id)[1];
    const ids = JSON.parse(reply.metadata).memory as string[];
    expect(getEvent(db, ids[0])?.reason).toBe("only have 10 hours a week");
    expect(undoFounderEvent(db, ids[0])).toBe("undone");
    expect(readFounder(db).profile.constraints).toEqual([]);
  });

  it("uses the saved profile in the next turn's system prompt", async () => {
    const provider = new FakeProvider({ structuredResult });
    const first = await collect(runChatTurn({ db, provider }, { message: "I only have 10 hours a week" }));
    const id = (first[0] as { conversationId: string }).conversationId;
    await collect(runChatTurn({ db, provider }, { conversationId: id, message: "what should I do?" }));
    const chatRequests = provider.requests.filter((r) => r.maxTokens === 32000);
    expect(chatRequests[1].system).toContain("10 hours a week");
  });

  it("does not run extraction when regenerating without a new message", async () => {
    const failing = await collect(
      runChatTurn({ db, provider: new FakeProvider({ failWith: new Error("x") }) }, { message: "hi" }),
    );
    const id = (failing[0] as { conversationId: string }).conversationId;
    const provider = new FakeProvider({ structuredResult });
    await collect(runChatTurn({ db, provider }, { conversationId: id }));
    expect(provider.requests.every((r) => r.maxTokens !== 1000)).toBe(true);
  });
});
