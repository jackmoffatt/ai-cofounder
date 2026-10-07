"use client";

import { Plus, X } from "lucide-react";
import { useRef } from "react";
import { IconButton } from "@/components/ui/IconButton";
import { cn } from "@/lib/cn";
import { useWorkspace } from "./WorkspaceProvider";

/** Browser-style working tabs. Quiet by design: the active tab is a raised pill, the rest are text. */
export function TabStrip() {
  const { state, activate, close, newTab } = useWorkspace();
  const list = useRef<HTMLDivElement>(null);

  // Roving focus inside the tablist: arrows move between tabs, Home/End jump to the ends.
  function onKeyDown(e: React.KeyboardEvent) {
    const keys = ["ArrowRight", "ArrowLeft", "Home", "End"];
    if (!keys.includes(e.key)) return;
    const tabs = [...(list.current?.querySelectorAll<HTMLElement>('[role="tab"]') ?? [])];
    const i = tabs.indexOf(document.activeElement as HTMLElement);
    if (i < 0) return;
    e.preventDefault();
    const next = e.key === "Home" ? 0 : e.key === "End" ? tabs.length - 1 : (i + (e.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
    tabs[next].focus();
  }

  return (
    <div className="flex h-10 shrink-0 items-center gap-1 px-3">
      <div ref={list} role="tablist" aria-label="Open conversations" onKeyDown={onKeyDown} className="flex min-w-0 items-center gap-0.5 overflow-x-auto">
        {state.tabs.map((t) => {
          const selected = t.key === state.activeKey;
          return (
            <div
              key={t.key}
              onAuxClick={(e) => {
                if (e.button === 1) {
                  e.preventDefault();
                  close(t.key);
                }
              }}
              className={cn(
                "group flex h-8 max-w-[220px] shrink-0 items-center rounded-md transition-[background-color,color,box-shadow] duration-[var(--dur-fast)] ease-out",
                selected ? "bg-surface text-fg shadow-sm" : "text-muted hover:bg-surface-2/70 hover:text-fg",
              )}
            >
              <button
                role="tab"
                id={`tab-${t.key}`}
                aria-selected={selected}
                aria-controls={`pane-${t.key}`}
                tabIndex={selected ? 0 : -1}
                onClick={() => activate(t.key)}
                className="h-full min-w-0 truncate rounded-md pl-3 pr-1.5 text-sm"
              >
                {t.title}
              </button>
              <button
                aria-label={`Close ${t.title}`}
                tabIndex={selected ? 0 : -1}
                onClick={() => close(t.key)}
                className={cn(
                  "mr-1 inline-flex size-5 shrink-0 items-center justify-center rounded-sm text-muted transition-opacity duration-[var(--dur-fast)] hover:bg-surface-2 hover:text-fg",
                  selected ? "opacity-100" : "opacity-0 focus-visible:opacity-100 group-hover:opacity-100",
                )}
              >
                <X size={12} />
              </button>
            </div>
          );
        })}
      </div>
      <IconButton label="New tab" onClick={() => newTab()} className="size-7 shrink-0">
        <Plus size={15} />
      </IconButton>
    </div>
  );
}
