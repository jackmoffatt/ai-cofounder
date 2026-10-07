import { cn } from "@/lib/cn";

export type CofounderState = "idle" | "listening" | "thinking" | "working" | "complete";

/**
 * Placeholder mark: a founder and a cofounder, two forms that overlap. The brand explorations in the
 * next milestone replace the artwork; the `state` prop is the hook the status animations attach to.
 */
export function BrandMark({ size = 20, state = "idle", className }: { size?: number; state?: CofounderState; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" data-state={state} className={cn("shrink-0", className)}>
      <circle cx="9" cy="12" r="6.5" fill="none" stroke="var(--text)" strokeWidth="1.8" />
      <circle cx="15" cy="12" r="6.5" fill="none" stroke="var(--accent)" strokeWidth="1.8" />
    </svg>
  );
}
