import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export function NavigationItem({
  children,
  active,
  onClick,
  trailing,
  disabled,
}: {
  children: ReactNode;
  active?: boolean;
  onClick?: () => void;
  trailing?: ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex h-8 w-full disabled:pointer-events-none disabled:opacity-40 items-center justify-between rounded-md px-3 text-left text-sm",
        "transition-colors duration-[var(--dur-fast)] ease-out",
        active ? "bg-surface-2 text-fg" : "text-muted hover:bg-surface-2 hover:text-fg",
      )}
    >
      <span className="truncate">{children}</span>
      {trailing}
    </button>
  );
}
