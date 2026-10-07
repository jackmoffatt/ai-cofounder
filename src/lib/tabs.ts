/** Workspace tab state as pure functions, so the rules (reuse, close, neighbours, persistence) are testable
 *  apart from React. A tab is a working context; for now that means one conversation. */

export interface Tab {
  /** Stable local identity. A tab keeps its key when a new chat gets its conversation id. */
  key: string;
  conversationId: string | null;
  title: string;
  /** True once something has been sent from this tab, so an untouched "New chat" tab can be reused. */
  used?: boolean;
}

export interface TabsState {
  tabs: Tab[];
  activeKey: string;
}

export const NEW_TAB_TITLE = "New chat";
export const MAX_TABS = 12;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function blankTab(key: string): Tab {
  return { key, conversationId: null, title: NEW_TAB_TITLE };
}

export function initialTabs(key: string): TabsState {
  return { tabs: [blankTab(key)], activeKey: key };
}

export const activeTab = (s: TabsState): Tab => s.tabs.find((t) => t.key === s.activeKey) ?? s.tabs[0];

/** `/` is a new chat, `/c/<id>` a stored one. Anything else isn't the chat workspace. */
export function parseChatPath(pathname: string): { conversationId: string | null } | null {
  if (pathname === "/") return { conversationId: null };
  const m = /^\/c\/([^/]+)\/?$/.exec(pathname);
  return m && UUID.test(m[1]) ? { conversationId: m[1] } : null;
}

export const urlFor = (tab: Tab): string => (tab.conversationId ? `/c/${tab.conversationId}` : "/");

export function activate(s: TabsState, key: string): TabsState {
  return s.tabs.some((t) => t.key === key) && s.activeKey !== key ? { ...s, activeKey: key } : s;
}

/** Adds a tab (evicting the oldest inactive one past the cap) and activates it. */
export function addTab(s: TabsState, tab: Tab): TabsState {
  let tabs = [...s.tabs, tab];
  while (tabs.length > MAX_TABS) {
    const drop = tabs.findIndex((t) => t.key !== tab.key && t.key !== s.activeKey);
    if (drop < 0) break;
    tabs = tabs.filter((_, i) => i !== drop);
  }
  return { tabs, activeKey: tab.key };
}

/** Focuses the tab already showing this conversation, else opens one for it. */
export function openConversation(s: TabsState, conversationId: string, title: string, key: string): TabsState {
  const existing = s.tabs.find((t) => t.conversationId === conversationId);
  if (existing) return activate(s, existing.key);
  return addTab(s, { key, conversationId, title: title || NEW_TAB_TITLE });
}

/** A new chat: reuses the active tab when it's still an untouched blank, so ⌘⇧O twice doesn't stack tabs. */
export function openBlank(s: TabsState, key: string): TabsState {
  const current = activeTab(s);
  if (current.conversationId === null && !current.used) return s;
  const blank = s.tabs.find((t) => t.conversationId === null && !t.used);
  return blank ? activate(s, blank.key) : addTab(s, blankTab(key));
}

export function closeTab(s: TabsState, key: string, freshKey: string): TabsState {
  const i = s.tabs.findIndex((t) => t.key === key);
  if (i < 0) return s;
  const tabs = s.tabs.filter((t) => t.key !== key);
  if (tabs.length === 0) return initialTabs(freshKey);
  if (s.activeKey !== key) return { ...s, tabs };
  return { tabs, activeKey: tabs[Math.min(i, tabs.length - 1)].key };
}

export function patchTab(s: TabsState, key: string, patch: Partial<Omit<Tab, "key">>): TabsState {
  if (!s.tabs.some((t) => t.key === key)) return s;
  return { ...s, tabs: s.tabs.map((t) => (t.key === key ? { ...t, ...patch } : t)) };
}

/** Next/previous tab, wrapping around. */
export function step(s: TabsState, delta: 1 | -1): TabsState {
  const i = s.tabs.findIndex((t) => t.key === s.activeKey);
  return { ...s, activeKey: s.tabs[(i + delta + s.tabs.length) % s.tabs.length].key };
}

/** Jumps to the nth tab (1-based); 9 means the last, as in browsers. */
export function jump(s: TabsState, n: number): TabsState {
  const tab = n >= 9 ? s.tabs[s.tabs.length - 1] : s.tabs[n - 1];
  return tab ? activate(s, tab.key) : s;
}

export function serialize(s: TabsState): string {
  return JSON.stringify({ v: 1, activeKey: s.activeKey, tabs: s.tabs.map(({ key, conversationId, title }) => ({ key, conversationId, title })) });
}

/** Reads saved tabs defensively: anything malformed is dropped rather than trusted. */
export function parse(raw: string | null): TabsState | null {
  if (!raw) return null;
  try {
    const data = JSON.parse(raw);
    if (data?.v !== 1 || !Array.isArray(data.tabs)) return null;
    const seen = new Set<string>();
    const tabs: Tab[] = [];
    for (const t of data.tabs) {
      if (typeof t?.key !== "string" || typeof t?.title !== "string" || seen.has(t.key)) continue;
      if (t.conversationId !== null && !(typeof t.conversationId === "string" && UUID.test(t.conversationId))) continue;
      seen.add(t.key);
      tabs.push({ key: t.key, conversationId: t.conversationId, title: t.title.slice(0, 100) });
    }
    if (tabs.length === 0) return null;
    return { tabs: tabs.slice(0, MAX_TABS), activeKey: tabs.some((t) => t.key === data.activeKey) ? data.activeKey : tabs[0].key };
  } catch {
    return null;
  }
}
