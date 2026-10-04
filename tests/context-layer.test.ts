import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { runChatTurn, type TurnEvent } from "@/agent/chat";
import { BUDGETS, buildContext } from "@/agent/contextBuilder";
import { classifyIntent, keywordsFrom, type Intent } from "@/agent/intent";
import { emptyExtraction } from "@/agent/extraction";
import { retrieve } from "@/agent/retrieval";
import { MIN_BATCH, WINDOW, updateSummary } from "@/agent/summary";
import { createDb, type Db } from "@/db/client";
import { addMessage, createConversation, getConversation, listMessages } from "@/db/queries/conversations";
import { getTraceForMessage, latestBrief, listBriefs } from "@/db/queries/context";
import { refFor } from "@/lib/memory";
import { estimateTokens } from "@/lib/tokens";
import { FakeProvider } from "@/services/ai/fake";
import { STALE_AFTER_EVENTS, briefStatus, generateBrief, readNextAction, renderStatusSections } from "@/services/brief";
import { addEvidence, createItem, deleteItem, updateItem } from "@/services/memory/items";
import { establishStartup, saveStartupEdit } from "@/services/memory/startup";

let db: Db;
beforeEach(() => {
  db = createDb(":memory:");
});

const intent = (p: Partial<Intent> = {}): Intent => ({ mode: "REVIEW", kinds: [], keywords: [], recall: false, wantsPlan: false, source: "model", ...p });
const mk = (kind: Parameters<typeof createItem>[1]["kind"], title: string, importance = 3, body = "") =>
  createItem(db, { kind, title, importance, body, origin: "manual", createdBy: "user" }).item;

describe("classifyIntent", () => {
  const modelSays = { mode: "VALIDATE", kinds: ["assumption"], keywords: ["students"], recall: false, wantsPlan: false };

  it("uses the model's classification", async () => {
    const provider = new FakeProvider({ structuredResult: modelSays });
    const r = await classifyIntent(provider, { message: "How do I test whether students care?", previousMode: null, stage: null });
    expect(r).toMatchObject({ mode: "VALIDATE", source: "model", kinds: ["assumption"] });
  });

  it("keeps the conversation's mode for a short follow-up without calling the model", async () => {
    const provider = new FakeProvider({ structuredResult: modelSays });
    const r = await classifyIntent(provider, { message: "yes, go on", previousMode: "STRATEGY", stage: null });
    expect(r).toMatchObject({ mode: "STRATEGY", source: "continuation" });
    expect(provider.requests).toHaveLength(0);
  });

  it("still classifies a short recall question", async () => {
    const provider = new FakeProvider({ structuredResult: { ...modelSays, mode: "REVIEW", recall: true } });
    const r = await classifyIntent(provider, { message: "where were we?", previousMode: "STRATEGY", stage: null });
    expect(r.source).toBe("model");
    expect(r.recall).toBe(true);
  });

  it("falls back to the stage's mode and plain keywords when the model fails", async () => {
    const provider = new FakeProvider({ failWith: new Error("down") });
    const r = await classifyIntent(provider, { message: "What did we decide about pricing for freelancers?", previousMode: null, stage: "validation" });
    expect(r).toMatchObject({ mode: "VALIDATE", source: "fallback", recall: true });
    expect(r.keywords).toContain("pricing");
    expect(r.keywords).not.toContain("what");
  });

  it("extracts keywords without filler", () => {
    expect(keywordsFrom("What should I do about the competitor pricing?")).toEqual(["competitor", "pricing"]);
  });
});

describe("retrieve", () => {
  it("shows each mode what it needs: validation gets open assumptions, strategy gets decisions", () => {
    mk("assumption", "Students struggle with scheduling", 5);
    mk("decision", "Target freshmen first", 4);
    mk("idea", "Calendar plugin", 2);
    const kinds = (mode: Intent["mode"]) => new Set(retrieve(db, intent({ mode })).map((r) => r.item.kind));
    expect(kinds("VALIDATE")).toContain("assumption");
    expect(kinds("VALIDATE")).toContain("decision");
    expect(kinds("STRATEGY")).toContain("decision");
    expect(kinds("BUILD")).not.toContain("idea");
  });

  it("leaves out deleted items, rejected assumptions and superseded decisions unless searched for", () => {
    const gone = mk("assumption", "Deleted claim");
    deleteItem(db, gone.id);
    const rejected = mk("assumption", "Rejected claim");
    updateItem(db, rejected.id, { status: "rejected" });
    const old = mk("decision", "Old pricing decision about subscriptions");
    updateItem(db, old.id, { status: "superseded" });

    const titles = retrieve(db, intent({ mode: "REVIEW" })).map((r) => r.item.title);
    expect(titles).toEqual([]);

    const searched = retrieve(db, intent({ mode: "REVIEW", keywords: ["pricing"] }));
    expect(searched.map((r) => r.item.title)).toEqual(["Old pricing decision about subscriptions"]);
    expect(searched[0].reason).toBe("keyword");
  });

  it("surfaces a specific item by keyword even when the recipe would not", () => {
    mk("idea", "Referral rewards for study groups");
    const r = retrieve(db, intent({ mode: "BUILD", keywords: ["referral"] }));
    expect(r.map((x) => x.item.title)).toEqual(["Referral rewards for study groups"]);
  });

  it("ranks by importance and respects the total cap", () => {
    for (let i = 0; i < 40; i++) mk("assumption", `Claim number ${i} about users`, (i % 5) + 1);
    const r = retrieve(db, intent({ mode: "VALIDATE", kinds: ["assumption"] }), 10);
    expect(r.length).toBeLessThanOrEqual(10);
    expect(r[0].item.importance).toBe(5);
  });
});

describe("buildContext", () => {
  const conv = () => createConversation(db);
  const fill = (convId: string, n: number) => {
    for (let i = 0; i < n; i++) addMessage(db, convId, i % 2 === 0 ? "user" : "assistant", `message ${i}`);
  };

  it("includes persona, founder, startup and relevant memory, with citation handles", () => {
    establishStartup(db, "Acme");
    const a = mk("assumption", "Students struggle with scheduling", 5);
    const c = conv();
    fill(c.id, 1);
    const built = buildContext(db, { conversation: c, stored: listMessages(db, c.id), intent: intent({ mode: "VALIDATE" }) });
    expect(built.system).toContain("## About the founder");
    expect(built.system).toContain("## The startup");
    expect(built.system).toContain(`[m:${refFor(a.id)}] Students struggle with scheduling`);
    expect(built.system).toContain("cite it inline");
    expect(built.refs[refFor(a.id)]).toMatchObject({ id: a.id, kind: "assumption" });
    expect(built.system).toContain("Mode: validation");
    expect(built.trace.items[0]).toMatchObject({ ref: refFor(a.id), reason: "recipe" });
  });

  it("does not ask the model to cite when nothing was retrieved", () => {
    const built = buildContext(db, { conversation: null, stored: [], intent: intent() });
    expect(built.system).not.toContain("cite it inline");
    expect(built.trace.items).toEqual([]);
  });

  it("keeps the memory section within its token budget however much is stored", () => {
    for (let i = 0; i < 80; i++) mk("assumption", `Claim ${i}: ${"words ".repeat(30)}`, 4);
    const built = buildContext(db, { conversation: null, stored: [], intent: intent({ mode: "VALIDATE" }) });
    const memory = built.trace.sections.find((s) => s.name === "memory")!;
    expect(memory.tokens).toBeLessThanOrEqual(BUDGETS.memory + 200); // header text is outside the line budget
    expect(built.trace.items.length).toBeLessThan(40);
  });

  it("sends only messages the summary does not cover, and includes the summary", () => {
    const c = conv();
    fill(c.id, 30);
    const withSummary = { ...getConversation(db, c.id)!, summary: "Earlier we discussed pricing.", summaryCount: 20 };
    const built = buildContext(db, { conversation: withSummary, stored: listMessages(db, c.id), intent: intent() });
    expect(built.messages[0].content).toBe("message 20");
    expect(built.messages).toHaveLength(10);
    expect(built.system).toContain("Earlier we discussed pricing.");
    expect(built.trace.summarizedMessages).toBe(20);
  });

  it("bounds raw history by tokens, keeps the latest message and starts on a user turn", () => {
    const c = conv();
    for (let i = 0; i < 12; i++) addMessage(db, c.id, i % 2 === 0 ? "user" : "assistant", `${i}: ${"x".repeat(4000)}`);
    addMessage(db, c.id, "user", "the latest question");
    const built = buildContext(db, { conversation: getConversation(db, c.id)!, stored: listMessages(db, c.id), intent: intent() });
    const tokens = built.messages.reduce((n, m) => n + estimateTokens(m.content), 0);
    expect(tokens).toBeLessThanOrEqual(BUDGETS.history + 1100);
    expect(built.messages.at(-1)!.content).toBe("the latest question");
    expect(built.messages[0].role).toBe("user");
  });

  it("adds other conversations and recent changes only when the founder is recalling", () => {
    const other = conv();
    addMessage(db, other.id, "user", "Let's talk about pricing for freelancers");
    mk("decision", "Charge per seat");
    const c = conv();
    const stored = [addMessage(db, c.id, "user", "where were we?")];

    const off = buildContext(db, { conversation: c, stored, intent: intent({ recall: false }) });
    expect(off.system).not.toContain("Where things were left");
    const on = buildContext(db, { conversation: c, stored, intent: intent({ recall: true }) });
    expect(on.system).toContain("Where things were left");
    expect(on.system).toContain("pricing for freelancers");
    expect(on.system).toContain("Decision: Charge per seat");
  });

  it("includes the latest brief", async () => {
    mk("assumption", "A claim");
    await generateBrief(db, new FakeProvider({ structuredResult: briefOut }), "manual");
    const built = buildContext(db, { conversation: null, stored: [], intent: intent() });
    expect(built.system).toContain("## Startup brief (version 1");
    expect(built.trace.briefVersion).toBe(1);
  });
});

describe("updateSummary", () => {
  const addN = (id: string, n: number) => {
    for (let i = 0; i < n; i++) addMessage(db, id, i % 2 === 0 ? "user" : "assistant", `m${i}`);
  };
  const summarizer = new FakeProvider({ completeResult: () => "A short summary." });

  it("does nothing until enough messages fall outside the window", async () => {
    const c = createConversation(db);
    addN(c.id, WINDOW + MIN_BATCH - 1);
    expect(await updateSummary(db, summarizer, c.id)).toBe(false);
    expect(summarizer.requests).toHaveLength(0);
  });

  it("folds older messages in and records how many are covered", async () => {
    const c = createConversation(db);
    addN(c.id, WINDOW + MIN_BATCH);
    expect(await updateSummary(db, summarizer, c.id)).toBe(true);
    expect(getConversation(db, c.id)).toMatchObject({ summary: "A short summary.", summaryCount: MIN_BATCH });
    expect(summarizer.requests[0].messages[0].content).toContain("m0");
    expect(summarizer.requests[0].messages[0].content).not.toContain(`m${MIN_BATCH}\n`);
  });

  it("leaves state untouched if the model fails", async () => {
    const c = createConversation(db);
    addN(c.id, WINDOW + 8);
    expect(await updateSummary(db, new FakeProvider({ failWith: new Error("x") }), c.id)).toBe(false);
    expect(getConversation(db, c.id)).toMatchObject({ summary: "", summaryCount: 0 });
  });
});

const briefOut = {
  narrative: "## Company\nThe founder believes students struggle; this is untested [m:deadbeef].\n\n## Where we are\nEarly.",
  nextAction: { action: "Interview five students", why: "The key assumption has no evidence." },
};

describe("Startup Brief", () => {
  it("renders status sections from the database: untested assumptions are never 'established'", () => {
    const a = mk("assumption", "Students struggle", 5);
    const b = mk("assumption", "Freelancers hate invoicing", 4);
    updateItem(db, b.id, { status: "validated" });
    mk("decision", "Target freshmen", 4);
    mk("question", "Who pays?", 3);
    const md = renderStatusSections(db);
    const established = md.split("## Established (validated by the founder)")[1].split("##")[0];
    expect(established).toContain("Freelancers hate invoicing");
    expect(established).not.toContain("Students struggle");
    expect(md).toContain("## Assumptions, not yet established");
    expect(md).toMatch(/Students struggle — untested, low confidence, no evidence/);
    expect(md).toContain("## Decisions");
    expect(md).toContain("## Open questions");
    expect(a.id).toBeTruthy();
  });

  it("composes narrative, database sections and the next action, and versions each generation", async () => {
    mk("assumption", "Students struggle", 5);
    const provider = new FakeProvider({ structuredResult: briefOut });
    const v1 = (await generateBrief(db, provider, "first"))!;
    expect(v1.version).toBe(1);
    expect(v1.content).toContain("# Startup brief");
    expect(v1.content).toContain("## Assumptions, not yet established");
    expect(v1.content).toContain("## Recommended next action\n**Interview five students**");
    expect(readNextAction(v1)).toEqual({ action: "Interview five students", why: "The key assumption has no evidence." });
    expect((await generateBrief(db, provider, "manual"))!.version).toBe(2);
    expect(listBriefs(db).map((b) => b.version)).toEqual([2, 1]);
  });

  it("drops citation handles that do not exist", async () => {
    const a = mk("assumption", "Students struggle", 5);
    const provider = new FakeProvider({
      structuredResult: { ...briefOut, narrative: `Believed [m:${refFor(a.id)}] but also [m:deadbeef] and [m:00000000].` },
    });
    const brief = (await generateBrief(db, provider, "first"))!;
    const narrative = brief.content.split("## Assumptions")[0];
    expect(narrative).toContain(`[m:${refFor(a.id)}]`);
    expect(narrative).not.toContain("deadbeef");
    expect(narrative).not.toContain("00000000");
  });

  it("keeps the previous version when generation fails", async () => {
    mk("idea", "Something");
    await generateBrief(db, new FakeProvider({ structuredResult: briefOut }), "first");
    expect(await generateBrief(db, new FakeProvider({ failWith: new Error("x") }), "stale")).toBeNull();
    expect(latestBrief(db)!.version).toBe(1);
  });

  it("is stale when there is content but no brief, and not when there is nothing to say", async () => {
    expect(briefStatus(db)).toEqual({ stale: false, reason: null });
    mk("idea", "Something");
    expect(briefStatus(db)).toEqual({ stale: true, reason: "first" });
    await generateBrief(db, new FakeProvider({ structuredResult: briefOut }), "first");
    expect(briefStatus(db).stale).toBe(false);
  });

  it("goes stale after enough material changes, but not too often", async () => {
    await generateBrief(db, new FakeProvider({ structuredResult: briefOut }), "first").catch(() => null);
    const a = mk("assumption", "Claim");
    await generateBrief(db, new FakeProvider({ structuredResult: briefOut }), "manual");
    for (let i = 0; i < STALE_AFTER_EVENTS; i++) {
      addEvidence(db, { itemId: a.id, stance: "supports", strength: "anecdotal", excerpt: `obs ${i}`, origin: "manual", createdBy: "user" });
    }
    const last = latestBrief(db)!;
    const justAfter = new Date(last.createdAt).getTime() + 1000;
    const later = new Date(last.createdAt).getTime() + 10 * 60 * 1000;
    expect(briefStatus(db, justAfter).stale).toBe(false); // too soon
    expect(briefStatus(db, later).stale).toBe(true);
  });

  it("a change of direction makes it stale immediately", async () => {
    const s = establishStartup(db, "Acme");
    await generateBrief(db, new FakeProvider({ structuredResult: briefOut }), "first");
    expect(briefStatus(db).stale).toBe(false);
    saveStartupEdit(db, s.id, { stage: "validation" });
    expect(briefStatus(db, Date.now() + 10_000).stale).toBe(true);
  });
});

describe("a chat turn leaves a trace", () => {
  const dispatch = (req: { system: string }) => {
    if (req.system.includes("You route one message")) return { mode: "VALIDATE", kinds: [], keywords: ["scheduling"], recall: false, wantsPlan: false };
    if (req.system.includes("You write the Startup Brief")) return briefOut;
    return emptyExtraction();
  };
  async function turn(provider: FakeProvider, message: string, conversationId?: string) {
    const out: TurnEvent[] = [];
    for await (const e of runChatTurn({ db, provider }, { message, conversationId })) out.push(e);
    return out;
  }

  it("records mode, retrieved items, section sizes and usage; reply carries citation handles", async () => {
    const a = mk("assumption", "Students struggle with scheduling", 5);
    const provider = new FakeProvider({ structuredResult: dispatch });
    const events = await turn(provider, "How should I test the scheduling problem?");

    const ctx = events.find((e) => e.type === "context");
    expect(ctx).toMatchObject({ refs: { [refFor(a.id)]: { id: a.id } } });

    const convId = (events.find((e) => e.type === "meta") as { conversationId: string }).conversationId;
    const reply = listMessages(db, convId).find((m) => m.role === "assistant")!;
    const meta = JSON.parse(reply.metadata);
    expect(meta.refs[refFor(a.id)]).toBeDefined();

    const trace = getTraceForMessage(db, reply.id)!;
    expect(trace.mode).toBe("VALIDATE");
    expect(trace.id).toBe(meta.traceId);
    const context = JSON.parse(trace.context);
    expect(context.items[0]).toMatchObject({ ref: refFor(a.id), reason: "keyword" }); // matched the recipe and "scheduling"
    expect(context.sections.map((s: { name: string }) => s.name)).toEqual(expect.arrayContaining(["persona", "founder", "startup", "memory", "history"]));
    expect(context.intent).toMatchObject({ mode: "VALIDATE", source: "model" });
    expect(trace.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("reuses the mode on a short follow-up and summarises once the chat gets long", async () => {
    const provider = new FakeProvider({ structuredResult: dispatch, completeResult: () => "Summary text." });
    const first = await turn(provider, "How should I test the scheduling problem?");
    const convId = (first.find((e) => e.type === "meta") as { conversationId: string }).conversationId;
    await turn(provider, "ok go on", convId);
    const traces = listMessages(db, convId).filter((m) => m.role === "assistant").map((m) => getTraceForMessage(db, m.id)!);
    expect(traces.map((t) => JSON.parse(t.context).intent.source)).toEqual(["model", "continuation"]);

    for (let i = 0; i < 8; i++) await turn(provider, `follow up number ${i} about it`, convId);
    expect(getConversation(db, convId)!.summaryCount).toBeGreaterThan(0);
    expect(getConversation(db, convId)!.summary).toBe("Summary text.");
  });

  it("falls back gracefully when classification fails; the reply still arrives", async () => {
    const provider = new FakeProvider({ structuredResult: (req: { system: string }) => { if (req.system.includes("You route")) throw new Error("down"); return emptyExtraction(); } });
    const events = await turn(provider, "What should I work on tonight?");
    expect(events.some((e) => e.type === "done")).toBe(true);
    const convId = (events.find((e) => e.type === "meta") as { conversationId: string }).conversationId;
    const reply = listMessages(db, convId).find((m) => m.role === "assistant")!;
    expect(JSON.parse(getTraceForMessage(db, reply.id)!.context).intent.source).toBe("fallback");
  });
});
