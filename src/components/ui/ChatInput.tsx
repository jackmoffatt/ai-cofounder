"use client";

import { ArrowUp } from "lucide-react";
import { useRef, useState, type KeyboardEvent } from "react";
import { cn } from "@/lib/cn";

/**
 * Auto-growing message box. Enter sends, Shift+Enter inserts a newline.
 * Attachment controls are intentionally absent until the feature exists.
 */
export function ChatInput({
  onSend,
  disabled,
  placeholder = "Ask your startup agent…",
  autoFocus,
}: {
  onSend: (text: string) => void;
  disabled?: boolean;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const [value, setValue] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);
  const canSend = value.trim().length > 0 && !disabled;

  function resize() {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  }

  function submit() {
    if (!canSend) return;
    onSend(value.trim());
    setValue("");
    requestAnimationFrame(resize);
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  }

  return (
    <div
      className={cn(
        "flex items-end gap-2 rounded-xl border border-line bg-surface p-2 pl-4 shadow-md",
        "transition-shadow duration-[var(--dur-base)] ease-out focus-within:shadow-lg",
      )}
    >
      <textarea
        ref={ref}
        rows={1}
        value={value}
        autoFocus={autoFocus}
        placeholder={placeholder}
        aria-label="Message"
        onChange={(e) => {
          setValue(e.target.value);
          resize();
        }}
        onKeyDown={onKeyDown}
        className="max-h-[220px] min-h-8 flex-1 resize-none bg-transparent py-1.5 text-[length:var(--fs-chat)] leading-snug text-fg placeholder:text-muted focus:outline-none"
      />
      <button
        onClick={submit}
        disabled={!canSend}
        aria-label="Send message"
        className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-accent text-accent-fg transition-opacity duration-[var(--dur-fast)] disabled:opacity-25"
      >
        <ArrowUp size={16} strokeWidth={2.25} />
      </button>
    </div>
  );
}
