import { NavigationItem } from "@/components/ui/NavigationItem";
import { ThemeToggle } from "@/components/shell/ThemeToggle";

const sections = ["Startup", "Memory", "Research", "Tasks", "Decisions"];

export function Sidebar({ onNewChat }: { onNewChat: () => void }) {
  return (
    <nav aria-label="Primary" className="flex h-full w-64 flex-col gap-1 px-3 py-4">
      <div className="mb-2 space-y-1">
        <NavigationItem onClick={onNewChat} active>
          New chat
        </NavigationItem>
        <NavigationItem disabled>Search</NavigationItem>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Conversation list arrives in Milestone 1. */}
        <p className="px-3 pt-4 text-xs text-muted">Conversations will appear here.</p>
      </div>

      <div className="space-y-1 border-t border-line pt-3">
        {sections.map((name) => (
          <NavigationItem key={name} disabled>
            {name}
          </NavigationItem>
        ))}
      </div>

      <div className="mt-2 flex items-center justify-between border-t border-line px-1 pt-3">
        <span className="px-2 text-sm text-muted">Settings</span>
        <ThemeToggle />
      </div>
    </nav>
  );
}
