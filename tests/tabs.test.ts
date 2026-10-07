import { describe, expect, it } from "vitest";
import {
  MAX_TABS, activate, activeTab, addTab, blankTab, closeTab, initialTabs, jump, openBlank, openConversation,
  parse, parseChatPath, patchTab, serialize, step, urlFor,
} from "@/lib/tabs";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

describe("tabs", () => {
  it("parses chat paths and rejects everything else", () => {
    expect(parseChatPath("/")).toEqual({ conversationId: null });
    expect(parseChatPath(`/c/${A}`)).toEqual({ conversationId: A });
    expect(parseChatPath(`/c/${A}/`)).toEqual({ conversationId: A });
    expect(parseChatPath("/c/not-a-uuid")).toBeNull();
    expect(parseChatPath("/memory")).toBeNull();
  });

  it("opens a conversation once and focuses it afterwards", () => {
    let s = initialTabs("k0");
    s = openConversation(s, A, "Pricing", "k1");
    s = openConversation(s, B, "Roadmap", "k2");
    expect(s.tabs.map((t) => t.key)).toEqual(["k0", "k1", "k2"]);
    s = openConversation(s, A, "Pricing", "k3");
    expect(s.tabs).toHaveLength(3);
    expect(activeTab(s).conversationId).toBe(A);
  });

  it("reuses an untouched blank tab for a new chat, but not a used one", () => {
    const s = initialTabs("k0");
    expect(openBlank(s, "k1")).toBe(s);
    const used = patchTab(s, "k0", { used: true });
    const next = openBlank(used, "k1");
    expect(next.tabs).toHaveLength(2);
    expect(next.activeKey).toBe("k1");
  });

  it("closes to the neighbour, and never leaves zero tabs", () => {
    let s = initialTabs("k0");
    s = addTab(s, { ...blankTab("k1"), conversationId: A });
    s = addTab(s, { ...blankTab("k2"), conversationId: B });
    s = activate(s, "k1");
    s = closeTab(s, "k1", "x");
    expect(s.activeKey).toBe("k2");
    s = closeTab(s, "k0", "x");
    expect(s.activeKey).toBe("k2");
    s = closeTab(s, "k2", "fresh");
    expect(s.tabs).toEqual([blankTab("fresh")]);
    expect(s.activeKey).toBe("fresh");
  });

  it("caps the number of tabs by evicting an inactive one", () => {
    let s = initialTabs("t0");
    for (let i = 1; i < MAX_TABS + 3; i++) s = addTab(s, blankTab(`t${i}`));
    expect(s.tabs).toHaveLength(MAX_TABS);
    expect(s.tabs.at(-1)?.key).toBe(s.activeKey);
  });

  it("steps and jumps like a browser", () => {
    let s = initialTabs("k0");
    s = addTab(addTab(s, blankTab("k1")), blankTab("k2"));
    expect(step(s, 1).activeKey).toBe("k0");
    expect(step(step(s, -1), -1).activeKey).toBe("k0");
    expect(jump(s, 2).activeKey).toBe("k1");
    expect(jump(s, 9).activeKey).toBe("k2");
    expect(jump(s, 5)).toBe(s);
  });

  it("gives a tab its conversation id without changing its key", () => {
    const s = patchTab(initialTabs("k0"), "k0", { conversationId: A, title: "Pricing", used: true });
    expect(urlFor(activeTab(s))).toBe(`/c/${A}`);
    expect(s.activeKey).toBe("k0");
  });

  it("round-trips through storage and drops malformed entries", () => {
    const s = patchTab(addTab(initialTabs("k0"), { ...blankTab("k1"), conversationId: A, title: "Pricing" }), "k0", { used: true });
    expect(parse(serialize(s))).toEqual({
      tabs: [{ key: "k0", conversationId: null, title: "New chat" }, { key: "k1", conversationId: A, title: "Pricing" }],
      activeKey: "k1",
    });
    expect(parse(null)).toBeNull();
    expect(parse("{nope")).toBeNull();
    expect(parse(JSON.stringify({ v: 2, tabs: [] }))).toBeNull();
    const dirty = JSON.stringify({ v: 1, activeKey: "zzz", tabs: [{ key: "a", conversationId: "<script>", title: "x" }, { key: "b", conversationId: B, title: "ok" }, { key: "b", conversationId: null, title: "dup" }] });
    expect(parse(dirty)).toEqual({ tabs: [{ key: "b", conversationId: B, title: "ok" }], activeKey: "b" });
  });
});
