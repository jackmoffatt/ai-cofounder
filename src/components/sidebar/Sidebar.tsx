"use client";

import { Trash2 } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { NavigationItem } from "@/components/ui/NavigationItem";
import { ThemeToggle } from "@/components/shell/ThemeToggle";
import { IconButton } from "@/components/ui/IconButton";
import { groupByDay, useConversations, type ConversationSummary } from "@/lib/useConversations";
import { usePendingProposals } from "@/lib/usePendingProposals";


function ConversationGroup({
  label,
  list,
  activeId,
  onOpen,
  onDelete,
}: {
  label: string;
  list: ConversationSummary[];
  activeId: string | null;
  onOpen: (path: string) => void;
  onDelete: (c: ConversationSummary) => void;
}) {
  if (list.length === 0) return null;
  return (
    <section className="mb-3">
      <h2 className="px-3 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wider text-muted">{label}</h2>
      <ul>
        {list.map((c) => (
          <li key={c.id} className="group relative">
            <NavigationItem active={c.id === activeId} onClick={() => onOpen(`/c/${c.id}`)}>
              {c.title}
            </NavigationItem>
            {c.snippet && <p className="truncate px-3 pb-1 text-xs text-muted">{c.snippet}</p>}
            <div className="absolute right-1 top-0.5 hidden group-focus-within:block group-hover:block">
              <IconButton label="Delete conversation" onClick={() => onDelete(c)} className="bg-surface-2">
                <Trash2 size={14} />
              </IconButton>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const router = useRouter();
  const pathname = usePathname();
  const [query, setQuery] = useState("");
  const { items, remove } = useConversations(query.trim());
  const pending = usePendingProposals();
  const activeId = pathname.startsWith("/c/") ? pathname.slice(3) : null;
  const { today, previous } = groupByDay(items);

  function open(path: string) {
    router.push(path);
    onNavigate?.();
  }

  async function onDelete(c: ConversationSummary) {
    if (!window.confirm(`Delete "${c.title}"? This can't be undone.`)) return;
    if ((await remove(c.id)) && c.id === activeId) open("/");
  }

  const shared = { activeId, onOpen: open, onDelete };

  return (
    <nav aria-label="Primary" className="flex h-full w-64 flex-col gap-1 px-3 py-4">
      <div className="mb-2 space-y-1">
        <NavigationItem onClick={() => open("/")} active={pathname === "/"}>
          New chat
        </NavigationItem>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search"
          aria-label="Search conversations"
          className="h-8 w-full rounded-md bg-transparent px-3 text-sm placeholder:text-muted hover:bg-surface-2 focus:bg-surface-2 focus:outline-none"
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {items.length === 0 ? (
          <p className="px-3 pt-4 text-xs text-muted">
            {query.trim() ? "No matches." : "Conversations will appear here."}
          </p>
        ) : query.trim() ? (
          <ConversationGroup label="Results" list={items} {...shared} />
        ) : (
          <>
            <ConversationGroup label="Today" list={today} {...shared} />
            <ConversationGroup label="Previous" list={previous} {...shared} />
          </>
        )}
      </div>

      <div className="space-y-1 border-t border-line pt-3">
        <NavigationItem onClick={() => open("/startup")} active={pathname === "/startup"}>
          Startup
        </NavigationItem>
        <NavigationItem
          onClick={() => open("/memory")}
          active={pathname === "/memory"}
          trailing={pending > 0 ? <span aria-label={`${pending} suggested changes`} className="size-1.5 rounded-full bg-accent" /> : undefined}
        >
          Memory
        </NavigationItem>
        <NavigationItem onClick={() => open("/tasks")} active={pathname === "/tasks"}>
          Tasks
        </NavigationItem>
        <NavigationItem onClick={() => open("/decisions")} active={pathname === "/decisions"}>
          Decisions
        </NavigationItem>
        <NavigationItem onClick={() => open("/research")} active={pathname === "/research"}>
          Research
        </NavigationItem>
      </div>

      <div className="mt-2 flex items-center justify-between border-t border-line px-1 pt-3">
        <span className="px-2 text-sm text-muted">Settings</span>
        <ThemeToggle />
      </div>
    </nav>
  );
}
