"use client";

import { X } from "lucide-react";
import { useEffect, type ReactNode } from "react";
import { IconButton } from "@/components/ui/IconButton";
import { cn } from "@/lib/cn";

/**
 * Right-hand panel for details behind a reference (an assumption, a source, a task). Hidden until
 * something opens it. Slides over the content on narrow screens.
 */
export function ContextPanel({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <aside
      aria-label={title}
      className={cn(
        "fixed inset-y-0 right-0 z-30 flex w-full max-w-[420px] flex-col border-l border-line bg-surface shadow-lg",
        "transition-[transform,visibility] duration-[var(--dur-base)] ease-out",
        open ? "translate-x-0" : "invisible translate-x-full",
      )}
    >
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-line px-4">
        <h2 className="text-sm font-medium text-muted">{title}</h2>
        <IconButton label="Close panel" onClick={onClose}>
          <X size={16} />
        </IconButton>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">{open ? children : null}</div>
    </aside>
  );
}
