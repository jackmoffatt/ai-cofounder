"use client";

import { MoreHorizontal, Search } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BrandMark } from "@/components/brand/BrandMark";
import { Menu } from "@/components/ui/Menu";
import { useWorkspace } from "@/components/workspace/WorkspaceProvider";
import { cn } from "@/lib/cn";
import { useIsMac } from "@/lib/platform";
import { useDebugMode } from "@/lib/useDebugMode";
import { usePendingProposals } from "@/lib/usePendingProposals";
import { ThemeToggle } from "./ThemeToggle";

const linkClass = (active: boolean) =>
  cn(
    "relative inline-flex h-8 items-center rounded-md px-3 text-sm transition-colors duration-[var(--dur-fast)] ease-out hover:text-fg",
    active ? "text-fg" : "text-muted",
  );

/** Deliberately light: the mark, three places, and the way into everything else (⌘K). */
export function TopBar({ onOpenPalette }: { onOpenPalette: () => void }) {
  const pathname = usePathname();
  const mac = useIsMac();
  const { onChatRoute, showChat } = useWorkspace();
  const pending = usePendingProposals();
  const debug = useDebugMode();

  return (
    <header className="flex h-12 shrink-0 items-center gap-1 px-3">
      <button aria-label="Cofounder: go to chat" onClick={showChat} className="mr-2 inline-flex size-8 items-center justify-center rounded-md hover:bg-surface-2">
        <BrandMark size={20} />
      </button>
      <nav aria-label="Primary" className="flex items-center">
        <button onClick={showChat} aria-current={onChatRoute ? "page" : undefined} className={linkClass(onChatRoute)}>
          Chat
        </button>
        <Link href="/tasks" aria-current={pathname === "/tasks" ? "page" : undefined} className={linkClass(pathname === "/tasks")}>
          Tasks
        </Link>
        <Link href="/memory" aria-current={pathname === "/memory" ? "page" : undefined} className={linkClass(pathname === "/memory")}>
          Memory
          {pending > 0 && <span role="img" aria-label={`${pending} suggested changes`} className="ml-1.5 size-1.5 rounded-full bg-accent" />}
        </Link>
      </nav>
      <div className="flex-1" />
      {debug && (
        <span className="mr-1 rounded-sm bg-surface-2 px-2 py-0.5 text-xs text-muted" title="Developer mode (Ctrl/Cmd+Shift+D to turn off)">
          Debug
        </span>
      )}
      <button
        onClick={onOpenPalette}
        aria-label="Open command menu"
        className="inline-flex h-8 items-center gap-2 rounded-md px-2.5 text-sm text-muted transition-colors duration-[var(--dur-fast)] hover:bg-surface-2 hover:text-fg"
      >
        <Search size={14} />
        <kbd className="hidden whitespace-nowrap font-sans text-xs sm:inline">{mac ? "⌘K" : "Ctrl K"}</kbd>
      </button>
      <ThemeToggle />
      <Menu
        label="More"
        trigger={<MoreHorizontal size={16} />}
        entries={[
          { label: "Startup", href: "/startup" },
          { label: "Research", href: "/research" },
          { label: "Decisions", href: "/decisions" },
          { label: "Settings", href: "/settings" },
        ]}
      />
    </header>
  );
}
