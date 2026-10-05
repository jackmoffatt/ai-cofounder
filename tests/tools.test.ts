import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

vi.mock("server-only", () => ({}));

import { runChatTurn, type TurnEvent } from "@/agent/chat";
import { emptyExtraction } from "@/agent/extraction";
import { runModelLoop, type LoopEvent } from "@/agent/loop";
import { createDb, type Db } from "@/db/client";
import { listItems } from "@/db/queries/memory";
import { getTraceForMessage } from "@/db/queries/context";
import { listCompetitorRows } from "@/db/queries/research";
import { listApprovals } from "@/db/queries/tools";
import { listMessages } from "@/db/queries/conversations";
import { FakeProvider } from "@/services/ai/fake";
import type { AIProvider, ChatEvent, ChatRequest } from "@/services/ai/types";
import { FakeFetcher, FakeSearch } from "@/services/research/fake";
import { SearchError } from "@/services/research/search";
import { createItem } from "@/services/memory/items";
import { createDefaultRegistry, toolNamesFor } from "@/tools";
import { ToolRegistry } from "@/tools/registry";
import type { Tool } from "@/tools/types";

let db: Db;
beforeEach(() => {
  db = createDb(":memory:");
});

const echo: Tool<{ text: string }> = {
  name: "echo",
  description: "Echoes text.",
  input: z.object({ text: z.string().min(1).describe("What to echo") }),
  risk: "read",
  label: (a) => `Echoing ${a.text}`,
  async execute(a, ctx) {
    ctx.report("halfway");
    return { ok: true, content: `echo:${a.text}`, refs: { abcd1234: { id: "i", kind: "note", title: "T" } } };
  },
};

const ctxFor = (extra: object = {}) => ({ db, provider: new FakeProvider(), conversationId: "c", report: () => {}, ...extra });

describe("ToolRegistry", () => {
  it("describes tools to the model as JSON Schema without provider-hostile keys", () => {
    const [spec] = new ToolRegistry().register(echo).specs(["echo", "nope"]);
    expect(spec).toMatchObject({ name: "echo", description: "Echoes text." });
    expect(spec.inputSchema).toMatchObject({ type: "object", required: ["text"], properties: { text: { type: "string", description: "What to echo" } } });
    expect(spec.inputSchema).not.toHaveProperty("$schema");
  });

  it("rejects duplicate names", () => {
    expect(() => new ToolRegistry().register(echo).register(echo)).toThrow(/already registered/);
  });

  it("validates arguments and returns errors the model can read instead of throwing", async () => {
    const r = new ToolRegistry().register(echo);
    const bad = await r.execute("echo", { text: "" }, ctxFor());
    expect(bad.result.ok).toBe(false);
    expect(bad.result.content).toMatch(/Invalid arguments for echo: text/);
    expect((await r.execute("missing", {}, ctxFor())).result.content).toMatch(/no tool called "missing"/);
  });

  it("runs a valid call and records what happened", async () => {
    const reports: string[] = [];
    const { result, record } = await new ToolRegistry().register(echo).execute("echo", { text: "hi" }, ctxFor({ report: (s: string) => reports.push(s) }));
    expect(result).toMatchObject({ ok: true, content: "echo:hi" });
    expect(reports).toEqual(["halfway"]);
    expect(record).toMatchObject({ name: "echo", ok: true, args: '{"text":"hi"}' });
    expect(record.ms).toBeGreaterThanOrEqual(0);
  });

  it("turns a thrown error into a generic failure without leaking details", async () => {
    const boom: Tool<object> = { name: "boom", description: "x", input: z.object({}), risk: "read", execute: async () => { throw new Error("secret internals"); } };
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { result } = await new ToolRegistry().register(boom).execute("boom", {}, ctxFor());
    expect(result.ok).toBe(false);
    expect(result.content).not.toContain("secret");
    spy.mockRestore();
  });

  it("truncates very long results", async () => {
    const big: Tool<object> = { name: "big", description: "x", input: z.object({}), risk: "read", execute: async () => ({ ok: true, content: "x".repeat(50_000) }) };
    expect((await new ToolRegistry().register(big).execute("big", {}, ctxFor())).result.content.length).toBe(12_000);
  });

  it("never runs an external-risk tool: it queues an approval and tells the model it did not happen", async () => {
    const send = vi.fn();
    const email: Tool<{ to: string }> = {
      name: "send_email",
      description: "Sends an email.",
      input: z.object({ to: z.string() }),
      risk: "external",
      describeForApproval: (a) => `Email ${a.to}`,
      execute: async (a) => { send(a); return { ok: true, content: "sent" }; },
    };
    const { result, record } = await new ToolRegistry().register(email).execute("send_email", { to: "dean@school.edu" }, ctxFor());
    expect(send).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    expect(result.content).toContain("NOT been done");
    expect(listApprovals(db)).toEqual([expect.objectContaining({ tool: "send_email", summary: "Email dean@school.edu", status: "pending" })]);
    expect(record.approvalId).toBe(listApprovals(db)[0].id);
  });
});

describe("toolNamesFor", () => {
  it("offers only what the message needs", () => {
    expect(toolNamesFor({ needsResearch: false, recall: false })).toEqual([]);
    expect(toolNamesFor({ needsResearch: false, recall: true })).toEqual(["search_memory"]);
    expect(toolNamesFor({ needsResearch: true, recall: false })).toEqual(["web_research", "search_memory"]);
  });
});

/** A provider that plays back scripted turns and records every request. */
class Scripted implements AIProvider {
  readonly name = "scripted";
  readonly requests: ChatRequest[] = [];
  constructor(private readonly turns: ChatEvent[][]) {}
  async *stream(req: ChatRequest) {
    this.requests.push(req);
    for (const e of this.turns[this.requests.length - 1] ?? [{ type: "text_delta" as const, text: "(out of script)" }, done("end_turn")]) yield e;
  }
  complete = async () => ({ text: "", usage: { inputTokens: 0, outputTokens: 0 } });
  structured = (async () => { throw new Error("unused"); }) as never;
}
const done = (stopReason: "end_turn" | "tool_use", native?: unknown): ChatEvent => ({ type: "done", stopReason, usage: { inputTokens: 10, outputTokens: 5 }, model: "m", native });
const call = (id: string, name: string, input: unknown): ChatEvent => ({ type: "tool_call", id, name, input });
const collect = async (gen: AsyncGenerator<LoopEvent>) => {
  const out: LoopEvent[] = [];
  for await (const e of gen) out.push(e);
  return out;
};
const loopInput = (provider: AIProvider, over: object = {}) => ({
  provider,
  registry: new ToolRegistry().register(echo),
  toolNames: ["echo"],
  model: "m",
  system: "sys",
  messages: [{ role: "user" as const, content: "go" }],
  maxTokens: 100,
  toolContext: { db, provider, conversationId: "c" },
  ...over,
});

describe("runModelLoop", () => {
  it("runs the tool the model asks for, feeds the result back, and returns the final answer", async () => {
    const native = [{ type: "thinking", thinking: "" }, { type: "tool_use", id: "t1" }];
    const p = new Scripted([
      [{ type: "text_delta", text: "Checking." }, call("t1", "echo", { text: "hi" }), done("tool_use", native)],
      [{ type: "text_delta", text: "Done: echo:hi" }, done("end_turn")],
    ]);
    const events = await collect(runModelLoop(loopInput(p)));

    expect(events.filter((e) => e.type === "text_delta").map((e) => (e as { text: string }).text)).toEqual(["Checking.", "\n\nDone: echo:hi"]);
    expect(events.filter((e) => e.type === "status").map((e) => (e as { text: string }).text)).toEqual(["Echoing hi", "halfway"]);
    expect(events.find((e) => e.type === "refs")).toMatchObject({ refs: { abcd1234: { id: "i" } } });

    const last = events.at(-1) as Extract<LoopEvent, { type: "done" }>;
    expect(last).toMatchObject({ type: "done", stopReason: "end_turn", usage: { inputTokens: 20, outputTokens: 10 } });
    expect(last.tools).toHaveLength(1);

    // The second request carries the assistant turn (with its native blocks) and the tool result.
    const second = p.requests[1].messages;
    expect(second).toHaveLength(3);
    expect(second[1]).toMatchObject({ role: "assistant", native, content: [{ type: "text", text: "Checking." }, { type: "tool_use", id: "t1", name: "echo", input: { text: "hi" } }] });
    expect(second[2]).toEqual({ role: "user", content: [{ type: "tool_result", toolUseId: "t1", content: "echo:hi" }] });
    expect(p.requests[0].tools?.map((t) => t.name)).toEqual(["echo"]);
  });

  it("reports failed tool calls to the model as errors and carries on", async () => {
    const p = new Scripted([[call("t1", "echo", { text: "" }), done("tool_use")], [{ type: "text_delta", text: "Sorry." }, done("end_turn")]]);
    await collect(runModelLoop(loopInput(p)));
    expect(p.requests[1].messages[2].content).toMatchObject([{ type: "tool_result", isError: true }]);
  });

  it("offers no tools on the final allowed step so the turn always ends in an answer", async () => {
    const loopForever = [call("t", "echo", { text: "x" }), done("tool_use")];
    const p = new Scripted([loopForever, loopForever, [{ type: "text_delta", text: "Final." }, done("end_turn")]]);
    const events = await collect(runModelLoop(loopInput(p, { maxSteps: 3 })));
    expect(p.requests).toHaveLength(3);
    expect(p.requests[0].tools).toBeDefined();
    expect(p.requests[2].tools).toBeUndefined();
    expect((events.at(-1) as { stopReason: string }).stopReason).toBe("end_turn");
  });

  it("does not offer tools at all when none are named", async () => {
    const p = new Scripted([[{ type: "text_delta", text: "Hi" }, done("end_turn")]]);
    await collect(runModelLoop(loopInput(p, { toolNames: [] })));
    expect(p.requests[0].tools).toBeUndefined();
  });
});

describe("a research turn", () => {
  const dispatch = (req: { system: string }) => {
    if (req.system.includes("You route one message")) return { mode: "RESEARCH", kinds: [], keywords: ["acme"], recall: false, wantsPlan: false, needsResearch: true };
    if (req.system.includes("extract verifiable research findings")) {
      return {
        findings: [{ claim: "Acme Scheduler's Pro plan costs $8 per user per month billed annually", implication: "Price below $8.", confidence: "high", support: [{ source: "S1", quote: "the Pro plan costs $8 per user per month billed annually" }, { source: "S2", quote: "The Pro plan costs $8 per user per month when billed annually" }] }],
        competitors: [{ company: "Acme Scheduler", fields: [{ field: "pricing", value: "Pro $8 per user per month", source: "S1", quote: "the Pro plan costs $8 per user per month billed annually" }] }],
        gaps: [],
      };
    }
    return emptyExtraction();
  };
  const research = { search: new FakeSearch(), fetcher: new FakeFetcher() };
  async function turn(provider: FakeProvider, message: string, r = research) {
    const out: TurnEvent[] = [];
    for await (const e of runChatTurn({ db, provider, research: r }, { message })) out.push(e);
    return out;
  }

  it("researches, stores verified findings, cites them in the reply, and traces the tool call", async () => {
    const provider = new FakeProvider({ structuredResult: dispatch });
    const events = await turn(provider, "Research what Acme Scheduler charges");

    const statuses = events.filter((e) => e.type === "status").map((e) => (e as { text: string }).text);
    expect(statuses).toEqual(expect.arrayContaining(["Reviewing startup context…", "Researching: Research what Acme Scheduler charges", expect.stringMatching(/^Searching:/), "Reading 3 pages…", "Checking sources…"]));

    const [finding] = listItems(db, { kind: "research" });
    expect(finding).toMatchObject({ confidence: "high", origin: "research" });
    expect(listCompetitorRows(db)).toHaveLength(1);

    const handle = finding.id.replace(/-/g, "").slice(0, 8);
    const reply = events.filter((e) => e.type === "delta").map((e) => (e as { text: string }).text).join("");
    expect(reply).toContain(`[m:${handle}]`);
    const lastContext = [...events].reverse().find((e) => e.type === "context") as { refs: Record<string, { id: string }> };
    expect(lastContext.refs[handle]).toMatchObject({ id: finding.id });

    const convId = (events.find((e) => e.type === "meta") as { conversationId: string }).conversationId;
    const message = listMessages(db, convId).find((m) => m.role === "assistant")!;
    expect(JSON.parse(message.metadata).refs[handle]).toBeDefined();
    const trace = getTraceForMessage(db, message.id)!;
    expect(JSON.parse(trace.outputs).tools).toEqual([expect.objectContaining({ name: "web_research", ok: true })]);
    expect(JSON.parse(trace.context).intent.needsResearch).toBe(true);
  });

  it("offers the research tool, and the guidance to use it honestly, only when research is needed", async () => {
    const provider = new FakeProvider({ structuredResult: dispatch });
    await turn(provider, "Research what Acme Scheduler charges");
    const chat = provider.requests.find((r) => r.maxTokens === 32000)!;
    expect(chat.tools?.map((t) => t.name)).toEqual(["web_research", "search_memory"]);
    expect(chat.system).toContain("web research tool");
    expect(chat.system).toContain("labelled as unchecked background");

    const quiet = new FakeProvider({ structuredResult: (r: { system: string }) => (r.system.includes("You route") ? { mode: "STRATEGY", kinds: [], keywords: [], recall: false, wantsPlan: false, needsResearch: false } : emptyExtraction()) });
    await turn(quiet, "Should I build the app first?");
    const chat2 = quiet.requests.find((r) => r.maxTokens === 32000)!;
    expect(chat2.tools).toBeUndefined();
    expect(chat2.system).not.toContain("web research tool");
  });

  it("when search fails the model is told, nothing is stored, and the reply says so", async () => {
    const provider = new FakeProvider({ structuredResult: dispatch });
    const events = await turn(provider, "Research what Acme Scheduler charges", { search: new FakeSearch(new SearchError("unavailable")), fetcher: new FakeFetcher() });
    const reply = events.filter((e) => e.type === "delta").map((e) => (e as { text: string }).text).join("");
    expect(reply).toContain("Research didn't work");
    expect(listItems(db, { kind: "research" })).toEqual([]);
    expect(events.some((e) => e.type === "done")).toBe(true);
  });

  it("search_memory finds recorded items, including closed ones, with handles", async () => {
    createItem(db, { kind: "decision", title: "Charge per seat for campus licences", origin: "manual", createdBy: "user" });
    const { result } = await createDefaultRegistry().execute("search_memory", { query: "campus licences" }, ctxFor());
    expect(result.content).toMatch(/\[m:[0-9a-f]{8}\] Charge per seat for campus licences \(decision · active\)/);
    expect(Object.keys(result.refs!)).toHaveLength(1);
    expect((await createDefaultRegistry().execute("search_memory", { query: "zzzzzz" }, ctxFor())).result.content).toContain("Nothing recorded");
  });
});
