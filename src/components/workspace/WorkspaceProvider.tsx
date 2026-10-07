"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  activate as activateTab, activeTab, closeTab as closeTabIn, initialTabs, jump as jumpIn, openBlank, openConversation as openConversationIn,
  addTab, blankTab, parse, parseChatPath, patchTab, serialize, step as stepIn, urlFor, type Tab, type TabsState,
} from "@/lib/tabs";

const STORAGE_KEY = "cofounder.tabs.v1";
const newKey = () => `t-${crypto.randomUUID()}`;

export interface WorkspaceApi {
  state: TabsState;
  /** True on `/` and `/c/<id>`, where the workspace is the visible page. */
  onChatRoute: boolean;
  setupProblem: string | null;
  /** Text to prefill in a tab's message box. */
  promptFor: (key: string) => string | undefined;
  open: (conversationId: string, title?: string) => void;
  newTab: (prompt?: string) => void;
  close: (key?: string) => void;
  /** Closes any tab showing a conversation that no longer exists. */
  closeConversation: (conversationId: string) => void;
  activate: (key: string) => void;
  step: (delta: 1 | -1) => void;
  jump: (n: number) => void;
  patch: (key: string, patch: Partial<Omit<Tab, "key">>) => void;
  /** Goes to the Chat workspace (the active tab) from wherever you are. */
  showChat: () => void;
}

const Ctx = createContext<WorkspaceApi | null>(null);

export function useWorkspace(): WorkspaceApi {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useWorkspace must be used inside WorkspaceProvider");
  return ctx;
}

/**
 * Owns the open tabs. Each tab is a working context that stays mounted while you're elsewhere, so a
 * stream keeps running and a draft survives. The URL always names the active tab (`/` or `/c/<id>`),
 * written with history.replaceState so switching tabs never piles up Back-button entries; external
 * navigation (links, ⌘K, Back) is reconciled into the tab set.
 */
export function WorkspaceProvider({ setupProblem, children }: { setupProblem: string | null; children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const ask = useSearchParams().get("ask");
  const onChatRoute = parseChatPath(pathname) !== null;
  // The server and first client render agree on one blank tab; saved tabs are merged in after mount.
  const [state, setState] = useState<TabsState>(() => initialTabs("t-initial"));
  const [hydrated, setHydrated] = useState(false);
  const stateRef = useRef(state);
  const prompts = useRef(new Map<string, string>());

  const commit = useCallback(
    (next: TabsState, opts: { go?: boolean | "replace" } = {}) => {
      const changedActive = next.activeKey !== stateRef.current.activeKey || urlFor(activeTab(next)) !== urlFor(activeTab(stateRef.current));
      stateRef.current = next;
      setState(next);
      if (opts.go === false || !changedActive) return;
      const url = urlFor(activeTab(next));
      if (window.location.pathname === url) return;
      if (parseChatPath(window.location.pathname)) window.history.replaceState(null, "", url);
      else if (opts.go !== "replace") router.push(url);
    },
    [router],
  );

  // Restore saved tabs and fold the URL we loaded on into them.
  useEffect(() => {
    let s = parse(safeGet()) ?? initialTabs(newKey());
    const target = parseChatPath(window.location.pathname);
    if (target) {
      s = target.conversationId ? openConversationIn(s, target.conversationId, "", newKey()) : openBlank(s, newKey());
    }
    stateRef.current = s;
    // Saved tabs live in localStorage, which the server render can't see: merging them in after mount is
    // the point of this effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState(s);
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (hydrated) safeSet(serialize(state));
  }, [state, hydrated]);

  // External navigation (a link, ⌘K, the Back button) lands on a chat URL: make the matching tab active.
  useEffect(() => {
    if (!hydrated) return;
    const target = parseChatPath(pathname);
    if (!target || (!target.conversationId && ask)) return; // the ask effect below opens its own tab
    const cur = stateRef.current;
    const next = target.conversationId ? openConversationIn(cur, target.conversationId, "", newKey()) : openBlank(cur, newKey());
    if (next !== cur) commit(next, { go: false });
  }, [pathname, ask, hydrated, commit]);

  // `/?ask=...` (e.g. "Ask the Cofounder about this" on the Research page) opens a fresh tab with the
  // question typed in, ready to send.
  useEffect(() => {
    if (!hydrated || !ask || pathname !== "/") return;
    // Swap out an untouched blank tab rather than leaving it behind next to the new one.
    const cur = stateRef.current;
    const here = activeTab(cur);
    const base = here.conversationId === null && !here.used ? { ...cur, tabs: cur.tabs.filter((t) => t.key !== here.key) } : cur;
    const next = addTab(base, blankTab(newKey()));
    prompts.current.set(next.activeKey, ask.slice(0, 500));
    commit(next, { go: false });
    window.history.replaceState(null, "", "/");
  }, [ask, pathname, hydrated, commit]);

  const api = useMemo<WorkspaceApi>(
    () => ({
      state,
      onChatRoute,
      setupProblem,
      promptFor: (key) => prompts.current.get(key),
      open: (id, title = "") => commit(openConversationIn(stateRef.current, id, title, newKey())),
      newTab: (prompt) => {
        const cur = stateRef.current;
        // With a prompt we want a fresh tab even if a blank one exists, so it can't clobber a draft.
        const next = prompt ? addTab(cur, blankTab(newKey())) : openBlank(cur, newKey());
        if (prompt) prompts.current.set(next.activeKey, prompt);
        commit(next);
      },
      close: (key) => commit(closeTabIn(stateRef.current, key ?? stateRef.current.activeKey, newKey())),
      closeConversation: (id) => {
        let next = stateRef.current;
        for (const t of next.tabs.filter((t) => t.conversationId === id)) next = closeTabIn(next, t.key, newKey());
        if (next !== stateRef.current) commit(next);
      },
      activate: (key) => commit(activateTab(stateRef.current, key)),
      step: (d) => commit(stepIn(stateRef.current, d)),
      jump: (n) => commit(jumpIn(stateRef.current, n)),
      // A tab learning its conversation id moves the URL, but never drags you back from another page.
      patch: (key, p) => commit(patchTab(stateRef.current, key, p), { go: "replace" }),
      showChat: () => router.push(urlFor(activeTab(stateRef.current))),
    }),
    [state, onChatRoute, setupProblem, commit, router],
  );

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

function safeGet(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function safeSet(value: string) {
  try {
    localStorage.setItem(STORAGE_KEY, value);
  } catch {
    /* storage unavailable: tabs just won't survive a reload */
  }
}
