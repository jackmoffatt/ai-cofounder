"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useRouter } from "next/navigation";
import { useWorkspace } from "@/components/workspace/WorkspaceProvider";
import { useIsMac } from "@/lib/platform";
import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { setDebugMode, useDebugMode } from "@/lib/useDebugMode";
import { useTheme } from "@/lib/useTheme";

interface ConversationHit {
  id: string;
  title: string;
  snippet: string | null;
}

interface Command {
  id: string;
  label: string;
  hint?: string;
  group: "Actions" | "Tabs" | "Go to" | "Conversations";
  run: () => void;
}

const PAGES: Array<[string, string]> = [
  ["Startup", "/startup"],
  ["Memory", "/memory"],
  ["Research", "/research"],
  ["Tasks", "/tasks"],
  ["Decisions", "/decisions"],
  ["Settings", "/settings"],
];

/**
 * The keyboard-first way around the app: type to filter actions and pages, or to search conversations
 * by title and content. Arrow keys move, Enter runs, Esc closes.
 */
export function CommandMenu({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const router = useRouter();
  const ws = useWorkspace();
  const mac = useIsMac();
  const { preference, setPreference } = useTheme();
  const debug = useDebugMode();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [found, setFound] = useState<{ q: string; list: ConversationHit[] }>({ q: "", list: [] });
  const listRef = useRef<HTMLDivElement>(null);

  // Conversations: the recent ones when empty, search results as you type.
  useEffect(() => {
    if (!open) return;
    const ctrl = new AbortController();
    const t = setTimeout(
      async () => {
        try {
          const res = await fetch(`/api/conversations?q=${encodeURIComponent(query.trim())}`, { signal: ctrl.signal });
          if (res.ok) setFound({ q: query.trim(), list: ((await res.json()).conversations as ConversationHit[]).slice(0, query.trim() ? 8 : 5) });
        } catch {
          /* aborted or offline */
        }
      },
      query.trim() ? 150 : 0,
    );
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [open, query]);

  // Results belong to the query they were fetched for; showing last query's list would let Enter open the wrong thing.
  const convs = useMemo(() => (found.q === query.trim() ? found.list : []), [found, query]);

  const commands = useMemo<Command[]>(() => {
    const go = (path: string) => () => router.push(path);
    const nextTheme = preference === "system" ? "light" : preference === "light" ? "dark" : "system";
    return [
      { id: "new", label: "New tab", hint: mac ? "⌘⇧O" : "Ctrl+Shift+O", group: "Actions", run: () => ws.newTab() },
      ...(ws.onChatRoute
        ? [
            { id: "close", label: "Close tab", hint: mac ? "⌥W" : "Alt+W", group: "Actions" as const, run: () => ws.close() },
            ...(ws.state.tabs.length > 1
              ? [
                  { id: "next", label: "Next tab", hint: mac ? "⌥]" : "Alt+]", group: "Actions" as const, run: () => ws.step(1) },
                  { id: "prev", label: "Previous tab", hint: mac ? "⌥[" : "Alt+[", group: "Actions" as const, run: () => ws.step(-1) },
                ]
              : []),
          ]
        : []),
      { id: "theme", label: `Switch theme (now ${preference}, next ${nextTheme})`, group: "Actions", run: () => setPreference(nextTheme) },
      { id: "debug", label: debug ? "Turn developer mode off" : "Turn developer mode on", group: "Actions", run: () => setDebugMode(!debug) },
      ...(ws.state.tabs.length > 1
        ? ws.state.tabs.map((t, i) => ({ id: `tab-${t.key}`, label: t.title, hint: i < 9 ? (mac ? `⌥${i + 1}` : `Alt+${i + 1}`) : undefined, group: "Tabs" as const, run: () => ws.activate(t.key) }))
        : []),
      ...PAGES.map(([label, path]) => ({ id: path, label, group: "Go to" as const, run: go(path) })),
      ...convs.map((c) => ({ id: `c-${c.id}`, label: c.title, hint: c.snippet ?? undefined, group: "Conversations" as const, run: () => ws.open(c.id, c.title) })),
    ];
  }, [router, preference, setPreference, debug, convs, ws, mac]);

  const q = query.trim().toLowerCase();
  const shown = commands.filter((c) => c.group === "Conversations" || !q || c.label.toLowerCase().includes(q));
  const index = Math.min(active, Math.max(0, shown.length - 1));

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${index}"]`)?.scrollIntoView({ block: "nearest" });
  }, [index]);

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive(Math.min(index + 1, shown.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive(Math.max(index - 1, 0));
    } else if (e.key === "Enter" && shown[index] && !e.nativeEvent.isComposing) {
      e.preventDefault();
      onOpenChange(false);
      shown[index].run();
    }
  }

  let lastGroup = "";
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) {
          setQuery("");
          setActive(0);
        }
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/25" />
        <Dialog.Content aria-describedby={undefined} className="fixed left-1/2 top-[14vh] z-50 w-[min(560px,calc(100vw-32px))] -translate-x-1/2 overflow-hidden rounded-xl border border-line bg-surface shadow-lg">
          <Dialog.Title className="sr-only">Command menu</Dialog.Title>
          <input
            autoFocus
            role="combobox"
            aria-expanded="true"
            aria-controls="command-list"
            aria-activedescendant={shown[index] ? `cmd-${index}` : undefined}
            aria-label="Search conversations or type a command"
            placeholder="Search conversations, switch tabs, or jump to…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
            className="h-12 w-full border-b border-line bg-transparent px-4 text-[length:var(--fs-base)] placeholder:text-muted focus:outline-none"
          />
          <div ref={listRef} id="command-list" role="listbox" className="max-h-[50vh] overflow-y-auto p-2">
            {shown.length === 0 && <p className="px-3 py-6 text-center text-sm text-muted">Nothing matches.</p>}
            {shown.map((c, i) => {
              const header = c.group !== lastGroup ? c.group : null;
              lastGroup = c.group;
              return (
                <div key={c.id}>
                  {header && <p className="px-3 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wider text-muted">{header}</p>}
                  <div
                    id={`cmd-${i}`}
                    role="option"
                    aria-selected={i === index}
                    data-index={i}
                    onMouseMove={() => setActive(i)}
                    onClick={() => {
                      onOpenChange(false);
                      c.run();
                    }}
                    className={cn("flex cursor-pointer items-baseline justify-between gap-3 rounded-md px-3 py-2 text-sm", i === index && "bg-surface-2")}
                  >
                    <span className="truncate">{c.label}</span>
                    {c.hint && <span className="shrink-0 truncate text-xs text-muted">{c.hint}</span>}
                  </div>
                </div>
              );
            })}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
