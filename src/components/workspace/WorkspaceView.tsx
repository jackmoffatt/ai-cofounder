"use client";

import { useState } from "react";
import { cn } from "@/lib/cn";
import { ChatPane } from "./ChatPane";
import { TabStrip } from "./TabStrip";
import { useWorkspace } from "./WorkspaceProvider";

/**
 * The chat workspace: tab strip plus one pane per tab. It stays mounted when you visit Memory or Tasks,
 * hidden rather than removed, so streams keep running and scroll positions survive. A tab's pane is
 * created on first visit and kept afterwards.
 */
export function WorkspaceView() {
  const { state, onChatRoute } = useWorkspace();
  const [visited, setVisited] = useState<ReadonlySet<string>>(() => new Set([state.activeKey]));
  // Derived state: React re-renders immediately when it is set during render.
  if (!visited.has(state.activeKey)) setVisited(new Set(visited).add(state.activeKey));

  return (
    <div
      aria-hidden={!onChatRoute}
      inert={!onChatRoute}
      className={cn("absolute inset-0 flex flex-col bg-bg", !onChatRoute && "invisible")}
    >
      <TabStrip />
      <div className="relative min-h-0 flex-1">
        {state.tabs.map((t) => {
          const active = t.key === state.activeKey;
          if (!active && !visited.has(t.key)) return null;
          return (
            <div
              key={t.key}
              role="tabpanel"
              id={`pane-${t.key}`}
              aria-labelledby={`tab-${t.key}`}
              aria-hidden={!active}
              inert={!active}
              className={cn("absolute inset-0 transition-opacity duration-[var(--dur-fast)] ease-out", active ? "opacity-100" : "pointer-events-none opacity-0")}
            >
              <ChatPane tab={t} active={active && onChatRoute} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
