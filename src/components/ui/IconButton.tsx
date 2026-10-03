import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Tooltip } from "./Tooltip";

/** Icon-only button. `label` is required: it is the accessible name and the tooltip. */
export function IconButton({
  label,
  children,
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; children: ReactNode }) {
  return (
    <Tooltip label={label}>
      <button
        aria-label={label}
        className={cn(
          "inline-flex size-8 items-center justify-center rounded-md text-muted",
          "transition-colors duration-[var(--dur-fast)] ease-out hover:bg-surface-2 hover:text-fg",
          "disabled:pointer-events-none disabled:opacity-40",
          className,
        )}
        {...props}
      >
        {children}
      </button>
    </Tooltip>
  );
}
