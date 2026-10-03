import type { InputHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "h-9 w-full rounded-md border border-line bg-surface px-3 text-sm text-fg placeholder:text-muted",
        "transition-colors duration-[var(--dur-fast)] ease-out focus:border-accent focus:outline-none",
        className,
      )}
      {...props}
    />
  );
}
