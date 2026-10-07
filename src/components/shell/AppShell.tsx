"use client";

import { useEffect, useState, type ReactNode } from "react";
import { WorkspaceProvider, useWorkspace } from "@/components/workspace/WorkspaceProvider";
import { WorkspaceView } from "@/components/workspace/WorkspaceView";
import { CommandMenu } from "./CommandMenu";
import { TopBar } from "./TopBar";
import { TooltipProvider } from "@/components/ui/Tooltip";
import { cn } from "@/lib/cn";
import { toggleDebugMode } from "@/lib/useDebugMode";

/** Top bar, the chat workspace (tabs), and whichever other page is open. */
export function AppShell({ children, setupProblem }: { children: ReactNode; setupProblem: string | null }) {
  return (
    <TooltipProvider>
      <WorkspaceProvider setupProblem={setupProblem}>
        <Shell>{children}</Shell>
      </WorkspaceProvider>
    </TooltipProvider>
  );
}

function Shell({ children }: { children: ReactNode }) {
  const ws = useWorkspace();
  const [paletteOpen, setPaletteOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Alt chords use e.code: on a Mac, Option+W types "∑", so e.key is no use.
      if (e.altKey && !e.metaKey && !e.ctrlKey && !e.shiftKey && ws.onChatRoute) {
        const digit = /^Digit([1-9])$/.exec(e.code);
        if (e.code === "KeyW") ws.close();
        else if (e.code === "BracketRight") ws.step(1);
        else if (e.code === "BracketLeft") ws.step(-1);
        else if (digit) ws.jump(Number(digit[1]));
        else return;
        e.preventDefault();
        return;
      }
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
      const key = e.key.toLowerCase();
      if (key === "k" && !e.shiftKey) {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      } else if (key === "o" && e.shiftKey) {
        e.preventDefault();
        ws.newTab();
      } else if (key === "d" && e.shiftKey) {
        e.preventDefault();
        toggleDebugMode();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ws]);

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <TopBar onOpenPalette={() => setPaletteOpen(true)} />
      <div className="relative min-h-0 flex-1">
        <WorkspaceView />
        <main className={cn("relative flex h-full min-w-0 flex-col", ws.onChatRoute && "hidden")}>{children}</main>
      </div>
      <CommandMenu open={paletteOpen} onOpenChange={setPaletteOpen} />
    </div>
  );
}
