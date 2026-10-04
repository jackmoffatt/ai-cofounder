"use client";

import { PanelLeft } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Sidebar } from "@/components/sidebar/Sidebar";
import { IconButton } from "@/components/ui/IconButton";
import { TooltipProvider } from "@/components/ui/Tooltip";
import { cn } from "@/lib/cn";
import { toggleDebugMode, useDebugMode } from "@/lib/useDebugMode";

/** Sidebar + main area. On narrow screens the sidebar becomes an overlay drawer. */
export function AppShell({ children }: { children: ReactNode }) {
  // Separate state per breakpoint: sidebar starts open on desktop, closed as a drawer on mobile.
  const [desktopOpen, setDesktopOpen] = useState(true);
  const [mobileOpen, setMobileOpen] = useState(false);
  const debug = useDebugMode();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "d") {
        e.preventDefault();
        toggleDebugMode();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const toggle = () => {
    setDesktopOpen((o) => !o);
    setMobileOpen((o) => !o);
  };

  return (
    <TooltipProvider>
      <div className="flex h-dvh overflow-hidden">
        <aside
          className={cn(
            "fixed inset-y-0 left-0 z-30 w-64 shrink-0 overflow-hidden bg-surface shadow-lg md:static md:bg-surface-2/60 md:shadow-none",
            "transition-[width,transform,visibility] duration-[var(--dur-base)] ease-out",
            !mobileOpen && "max-md:invisible max-md:-translate-x-full",
            !desktopOpen && "md:invisible md:w-0",
          )}
        >
          <Sidebar onNavigate={() => setMobileOpen(false)} />
        </aside>

        {mobileOpen && (
          <button
            aria-label="Close sidebar"
            className="fixed inset-0 z-20 bg-black/20 md:hidden"
            onClick={() => setMobileOpen(false)}
          />
        )}

        <main className="relative flex min-w-0 flex-1 flex-col">
          <div className="absolute left-3 top-3 z-10">
            <IconButton label="Toggle sidebar" onClick={toggle}>
              <PanelLeft size={16} />
            </IconButton>
          </div>
          {debug && (
            <span className="absolute right-3 top-3 z-10 rounded-sm bg-surface-2 px-2 py-0.5 text-xs text-muted" title="Developer mode (Ctrl/Cmd+Shift+D to turn off)">
              Debug
            </span>
          )}
          {children}
        </main>
      </div>
    </TooltipProvider>
  );
}
