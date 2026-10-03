"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";

type Status = "idle" | "saving" | "saved" | "error";

/**
 * A label + auto-growing textarea that saves when it loses focus (only if the text changed).
 * Quiet by design: no Save button, just a small status word.
 */
export function EditableField({
  label,
  hint,
  value,
  placeholder,
  onSave,
  rows = 1,
}: {
  label: string;
  hint?: string;
  value: string;
  placeholder?: string;
  onSave: (value: string) => Promise<void>;
  rows?: number;
}) {
  const [draft, setDraft] = useState(value);
  const [status, setStatus] = useState<Status>("idle");
  const ref = useRef<HTMLTextAreaElement>(null);
  const saved = useRef(value);

  function fit() {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }
  useEffect(fit, [draft]);

  async function commit() {
    if (draft === saved.current) return;
    setStatus("saving");
    try {
      await onSave(draft);
      saved.current = draft;
      setStatus("saved");
      setTimeout(() => setStatus((s) => (s === "saved" ? "idle" : s)), 1500);
    } catch {
      setStatus("error");
    }
  }

  return (
    <label className="block">
      <span className="flex items-baseline justify-between">
        <span className="text-sm font-medium">{label}</span>
        <span
          aria-live="polite"
          className={cn("text-xs transition-opacity duration-[var(--dur-base)]", status === "idle" ? "opacity-0" : "opacity-100", status === "error" ? "text-fg" : "text-muted")}
        >
          {status === "saving" ? "Saving…" : status === "saved" ? "Saved" : status === "error" ? "Couldn't save. Try again." : " "}
        </span>
      </span>
      {hint && <span className="block text-xs text-muted">{hint}</span>}
      <textarea
        ref={ref}
        rows={rows}
        value={draft}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        className="mt-1.5 block w-full resize-none rounded-md border border-line bg-surface px-3 py-2 text-[length:var(--fs-base)] leading-relaxed placeholder:text-muted/70 transition-colors duration-[var(--dur-fast)] focus:border-accent focus:outline-none"
      />
    </label>
  );
}
