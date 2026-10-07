import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { sql } from "drizzle-orm";
import { runChatTurn } from "@/agent/chat";
import { createDb, type Db } from "@/db/client";
import { addMessage, createConversation, listConversations, searchConversations } from "@/db/queries/conversations";
import { getItem, listEventsForEntity, listItems } from "@/db/queries/memory";
import { getTaskRow } from "@/db/queries/work";
import { FakeProvider } from "@/services/ai/fake";
import { DEFAULTS, MODEL_ROLES, modelFor, modelSource, setModelOverrides } from "@/services/ai/models";
import { DATA_TABLES, deleteAllData, exportAll } from "@/services/dataExport";
import { healthReport, setupProblem } from "@/services/health";
import { addEvidence, createItem, deleteItem } from "@/services/memory/items";
import { establishStartup, saveStartupEdit } from "@/services/memory/startup";
import { applyFounderCandidates } from "@/services/memory/founder";
import { SettingsError, loadModelOverrides, readModelOverrides, saveModelOverride } from "@/services/settings";
import { listTrash, purgeFromTrash, restoreFromTrash } from "@/services/trash";
import { createExperiment } from "@/services/work/experiments";
import { createObjective } from "@/services/work/objectives";
import { createTask, deleteTask } from "@/services/work/tasks";

let db: Db;
beforeEach(() => {
  db = createDb(":memory:");
  setModelOverrides({});
});
afterEach(() => {
  setModelOverrides({});
  vi.unstubAllEnvs();
});

describe("model settings", () => {
  it("precedence: saved setting, then environment, then default", () => {
    expect(modelFor("chat")).toBe(DEFAULTS.chat);
    expect(modelSource("chat")).toBe("default");
    vi.stubEnv("AI_MODEL_CHAT", "claude-sonnet-5-5");
    expect(modelFor("chat")).toBe("claude-sonnet-5-5");
    expect(modelSource("chat")).toBe("environment");
    saveModelOverride(db, "chat", "claude-opus-4-8");
    expect(modelFor("chat")).toBe("claude-opus-4-8");
    expect(modelSource("chat")).toBe("setting");
  });

  it("clearing a role returns it to the environment/default, and only that role changes", () => {
    saveModelOverride(db, "chat", "claude-opus-4-8");
    saveModelOverride(db, "title", "claude-sonnet-5-5");
    saveModelOverride(db, "chat", null);
    expect(modelFor("chat")).toBe(DEFAULTS.chat);
    expect(modelFor("title")).toBe("claude-sonnet-5-5");
    expect(readModelOverrides(db)).toEqual({ title: "claude-sonnet-5-5" });
  });

  it("rejects things that are not model IDs, and unknown roles", () => {
    for (const bad of ["", "a", "rm -rf /", "model with spaces", "x".repeat(200), "<script>"]) {
      if (bad === "") continue; // empty clears
      expect(() => saveModelOverride(db, "chat", bad), bad).toThrow(SettingsError);
    }
    expect(() => saveModelOverride(db, "nonsense" as never, "claude-opus-5-5")).toThrow(SettingsError);
  });

  it("survives a restart: overrides are reloaded from the database", () => {
    saveModelOverride(db, "brief", "claude-opus-5-5");
    setModelOverrides({});
    expect(modelFor("brief")).toBe(DEFAULTS.brief);
    loadModelOverrides(db);
    expect(modelFor("brief")).toBe("claude-opus-5-5");
  });

  it("ignores corrupt or hostile stored values", () => {
    db.run(sql`INSERT INTO settings (key, value, updated_at) VALUES ('model_overrides', '{"chat":"<script>","title":42,"brief":"claude-opus-5-5"}', 'x')`);
    expect(readModelOverrides(db)).toEqual({ brief: "claude-opus-5-5" });
    db.run(sql`UPDATE settings SET value = 'not json'`);
    expect(readModelOverrides(db)).toEqual({});
  });

  it("is shared through globalThis, so separately bundled pages and routes see the same settings", async () => {
    saveModelOverride(db, "chat", "claude-opus-4-8");
    vi.resetModules(); // a second, independent copy of the module, as a different bundle would have
    const second = await import("@/services/ai/models");
    expect(second.modelFor("chat")).toBe("claude-opus-4-8");
    expect(second.modelSource("chat")).toBe("setting");
  });

  it("covers every role the app uses", () => {
    expect(MODEL_ROLES.length).toBe(Object.keys(DEFAULTS).length);
  });
});

describe("health report", () => {
  it("reports whether keys exist but never their value", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-super-secret-value");
    vi.stubEnv("BRAVE_API_KEY", "brave-secret-value");
    const report = healthReport(db);
    const json = JSON.stringify(report);
    expect(report.ai).toEqual({ provider: "anthropic", keyConfigured: true });
    expect(json).not.toContain("super-secret");
    expect(json).not.toContain("brave-secret");
    expect(report.database.ok).toBe(true);
    expect(report.models).toHaveLength(MODEL_ROLES.length);
  });

  it("flags a missing key, and the first-run problem is a plain sentence", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("AI_PROVIDER", "anthropic");
    expect(healthReport(db).ai.keyConfigured).toBe(false);
    expect(setupProblem()).toContain("ANTHROPIC_API_KEY");
    vi.stubEnv("AI_PROVIDER", "fake");
    expect(setupProblem()).toBeNull();
  });

  it("search configuration follows the chosen backend", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("SEARCH_BACKEND", "brave");
    vi.stubEnv("BRAVE_API_KEY", "");
    expect(healthReport(db).search).toMatchObject({ backend: "brave", configured: false });
    vi.stubEnv("BRAVE_API_KEY", "k");
    expect(healthReport(db).search.configured).toBe(true);
  });
});

/** A database with something in every table that holds founder data. */
async function populate(d: Db) {
  const startup = establishStartup(d, "CampusSync");
  saveStartupEdit(d, startup.id, { stage: "validation", currentObjective: "Interview students" });
  applyFounderCandidates(d, [{ field: "skills", value: "Python", evidence: "I write Python" }], { conversationId: "c" });
  const provider = new FakeProvider({ structuredResult: { findings: [], competitors: [], gaps: [] } });
  for await (const _ of runChatTurn({ db: d, provider }, { message: "I think students struggle with scheduling" })) void _;
  const { item } = createItem(d, { kind: "assumption", title: "Students struggle", origin: "manual", createdBy: "user" });
  addEvidence(d, { itemId: item.id, stance: "supports", strength: "anecdotal", excerpt: "one said so", origin: "manual", createdBy: "user" });
  createObjective(d, { title: "Find out", createdBy: "user" });
  createExperiment(d, { hypothesis: "h", assumptionId: item.id, createdBy: "user" });
  const a = createTask(d, { title: "Write script", origin: "manual", createdBy: "user" }).task;
  createTask(d, { title: "Run interviews", origin: "manual", createdBy: "user", dependsOn: [a.id] });
  return item;
}

describe("export", () => {
  it("contains every table, with counts that match the data", async () => {
    await populate(db);
    const file = exportAll(db, new Date("2026-10-07T12:00:00Z"));
    expect(file).toMatchObject({ format: "cofounder-export", version: 1, exportedAt: "2026-10-07T12:00:00.000Z" });
    expect(Object.keys(file.data).sort()).toEqual(Object.keys(DATA_TABLES).sort());
    for (const [name, rows] of Object.entries(file.data)) expect(file.counts[name]).toBe(rows.length);
    for (const name of ["founder", "startups", "conversations", "messages", "memoryItems", "evidence", "memoryEvents", "objectives", "experiments", "tasks", "taskDeps"]) {
      expect(file.counts[name], name).toBeGreaterThan(0);
    }
  });

  it("is plain JSON that round-trips, includes soft-deleted rows, and holds no secrets", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-should-never-appear");
    const item = await populate(db);
    deleteItem(db, item.id);
    const text = JSON.stringify(exportAll(db));
    expect(JSON.parse(text).data.memoryItems.some((i: { id: string; deletedAt: string | null }) => i.id === item.id && i.deletedAt)).toBe(true);
    expect(text).not.toContain("sk-ant");
    expect(text).not.toContain("should-never-appear");
  });
});

describe("delete all data", () => {
  it("empties every table and both search indexes, keeps settings, and the app still works", async () => {
    await populate(db);
    saveModelOverride(db, "chat", "claude-opus-4-8");
    deleteAllData(db);

    const file = exportAll(db);
    expect(Object.values(file.counts).every((n) => n === 0)).toBe(true);
    expect(searchConversations(db, "students")).toEqual([]);
    expect(db.all(sql`SELECT * FROM messages_fts`)).toEqual([]);
    expect(db.all(sql`SELECT * FROM memory_items_fts`)).toEqual([]);
    expect(readModelOverrides(db)).toEqual({ chat: "claude-opus-4-8" });

    // And it can be used again from scratch.
    const c = createConversation(db);
    addMessage(db, c.id, "user", "fresh start");
    expect(listConversations(db)).toHaveLength(1);
    expect(searchConversations(db, "fresh")).toHaveLength(1);
  });
});

describe("trash", () => {
  it("lists soft-deleted items and tasks, and restoring brings them back", () => {
    const { item } = createItem(db, { kind: "idea", title: "An idea", origin: "manual", createdBy: "user" });
    const task = createTask(db, { title: "A task", origin: "manual", createdBy: "user" }).task;
    deleteItem(db, item.id);
    deleteTask(db, task.id);
    expect(listTrash(db).map((e) => [e.type, e.title]).sort()).toEqual([["item", "An idea"], ["task", "A task"]]);

    expect(restoreFromTrash(db, "item", item.id)).toBe(true);
    expect(restoreFromTrash(db, "task", task.id)).toBe(true);
    expect(listItems(db).map((i) => i.id)).toEqual([item.id]);
    expect(getTaskRow(db, task.id)!.deletedAt).toBeNull();
    expect(listTrash(db)).toEqual([]);
    expect(restoreFromTrash(db, "item", item.id)).toBe(false); // not in the trash any more
  });

  it("purging removes the row, what hangs off it, and its audit history, but only from the trash", () => {
    const { item } = createItem(db, { kind: "assumption", title: "Secret claim", origin: "manual", createdBy: "user" });
    addEvidence(db, { itemId: item.id, stance: "supports", strength: "anecdotal", excerpt: "x", origin: "manual", createdBy: "user" });
    expect(purgeFromTrash(db, "item", item.id)).toBe(false); // still live: refuse
    expect(getItem(db, item.id)).toBeDefined();

    deleteItem(db, item.id);
    expect(purgeFromTrash(db, "item", item.id)).toBe(true);
    expect(getItem(db, item.id)).toBeUndefined();
    expect(db.all(sql`SELECT * FROM evidence`)).toEqual([]);
    expect(listEventsForEntity(db, "memory_item", item.id)).toEqual([]);
    expect(db.all(sql`SELECT * FROM memory_items_fts WHERE item_id = ${item.id}`)).toEqual([]);
  });

  it("purging a task also drops its dependency links", () => {
    const a = createTask(db, { title: "A", origin: "manual", createdBy: "user" }).task;
    const b = createTask(db, { title: "B", origin: "manual", createdBy: "user", dependsOn: [a.id] }).task;
    deleteTask(db, a.id);
    expect(purgeFromTrash(db, "task", a.id)).toBe(true);
    expect(db.all(sql`SELECT * FROM task_deps`)).toEqual([]);
    expect(getTaskRow(db, b.id)).toBeDefined();
  });
});

import { isAllowedHost } from "@/lib/security";

describe("host allow-list (DNS rebinding)", () => {
  it("answers to loopback names with or without a port", () => {
    for (const h of ["localhost", "localhost:3000", "127.0.0.1:3000", "127.0.0.1", "[::1]:3000", "LOCALHOST:8080"]) expect(isAllowedHost(h, ""), h).toBe(true);
  });

  it("refuses anything else, including look-alikes, unless explicitly allowed", () => {
    for (const h of ["evil.example", "evil.example:3000", "localhost.evil.example", "127.0.0.1.evil.example", "0.0.0.0:3000", "192.168.1.5:3000", "", null]) {
      expect(isAllowedHost(h as string | null, ""), String(h)).toBe(false);
    }
    expect(isAllowedHost("laptop.tailnet.ts.net:3000", "laptop.tailnet.ts.net")).toBe(true);
    expect(isAllowedHost("other.example", "laptop.tailnet.ts.net, foo.local")).toBe(false);
  });
});
