"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";

export interface MenuEntry {
  label: string;
  href?: string;
  onSelect?: () => void;
}

/** A small dropdown: opens on click, closes on outside click, Escape or selection. Arrow keys move. */
export function Menu({ label, trigger, entries, align = "right" }: { label: string; trigger: ReactNode; entries: MenuEntry[]; align?: "left" | "right" }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    root.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      setOpen(false);
      button.current?.focus();
      return;
    }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const items = [...(root.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    const i = items.indexOf(document.activeElement as HTMLElement);
    items[(i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
  }

  const itemClass = "block w-full rounded-md px-3 py-1.5 text-left text-sm transition-colors duration-[var(--dur-fast)] hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-none";

  return (
    <div ref={root} className="relative" onKeyDown={onKeyDown}>
      <button
        ref={button}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex size-8 items-center justify-center rounded-md text-muted transition-colors duration-[var(--dur-fast)] hover:bg-surface-2 hover:text-fg"
      >
        {trigger}
      </button>
      {open && (
        <div role="menu" aria-label={label} className={cn("animate-pop absolute top-full z-40 mt-1 min-w-44 rounded-lg border border-line bg-surface p-1 shadow-lg", align === "right" ? "right-0" : "left-0")}>
          {entries.map((e) =>
            e.href ? (
              <Link key={e.label} role="menuitem" href={e.href} onClick={() => setOpen(false)} className={itemClass}>
                {e.label}
              </Link>
            ) : (
              <button
                key={e.label}
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  e.onSelect?.();
                }}
                className={itemClass}
              >
                {e.label}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}
