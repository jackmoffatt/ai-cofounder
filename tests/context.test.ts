import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { runChatTurn, type TurnEvent } from "@/agent/chat";
import { buildSystemPrompt } from "@/agent/contextBuilder";
import { extractFounderFacts } from "@/agent/extraction";
import { createDb, type Db } from "@/db/client";
import { listMessages } from "@/db/queries/conversations";
import { getEvent } from "@/db/queries/profile";
import { FakeProvider } from "@/services/ai/fake";
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

describe("extractFounderFacts", () => {
  const input = { userMessage: "I'm Jack and I write Python daily.", knownName: null, knownProfile: {} };

  it("keeps updates whose evidence is quoted from the message and drops the rest", async () => {
    const provider = new FakeProvider({
      structuredResult: {
        updates: [
          { field: "skills", value: "writes Python daily", evidence: "I write Python daily" },
          { field: "skills", value: "expert in Rust", evidence: "I am a Rust expert" },
          { field: "name", value: "Jack", evidence: "I'm Jack" },
        ],
      },
    });
    const out = await extractFounderFacts(provider, input);
    expect(out.map((u) => u.value)).toEqual(["writes Python daily", "Jack"]);
  });

  it("returns nothing, without throwing, when the provider fails", async () => {
    const provider = new FakeProvider({ failWith: new Error("boom") });
    expect(await extractFounderFacts(provider, input)).toEqual([]);
  });

  it("tells the model what is already known so it can skip it", async () => {
    const provider = new FakeProvider();
    await extractFounderFacts(provider, { ...input, knownName: "Jack", knownProfile: { skills: ["SQL"] } });
    expect(provider.requests[0].messages[0].content).toContain("skills: SQL");
    expect(provider.requests[0].messages[0].content).toContain("name: Jack");
  });
});

describe("chat turn with memory", () => {
  const structuredResult = {
    updates: [{ field: "constraints", value: "10 hours a week", evidence: "only have 10 hours a week" }],
  };

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
