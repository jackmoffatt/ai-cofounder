"use client";

import { useState } from "react";

export interface MemoryNote {
  eventId: string;
  summary: string;
  reason: string;
  undone: boolean;
}

/** Quiet, expandable-on-hover line showing what was saved to the founder profile, with undo. */
export function MemoryNotes({ notes }: { notes: MemoryNote[] }) {
  const [undone, setUndone] = useState<Set<string>>(() => new Set(notes.filter((n) => n.undone).map((n) => n.eventId)));
  const [failed, setFailed] = useState<string | null>(null);

  async function undo(id: string) {
    setFailed(null);
    const res = await fetch(`/api/memory/events/${id}/undo`, { method: "POST" });
    if (res.ok) setUndone((prev) => new Set(prev).add(id));
    else setFailed(id);
  }

  return (
    <ul className="mt-2 space-y-0.5 text-xs text-muted" aria-label="Saved to your profile">
      {notes.map((n) => {
        const isUndone = undone.has(n.eventId);
        return (
          <li key={n.eventId} className="flex items-baseline gap-2" title={n.reason ? `From: “${n.reason}”` : undefined}>
            <span className={isUndone ? "line-through opacity-60" : undefined}>
              {isUndone ? "Removed from" : "Saved to"} your profile · {n.summary}
            </span>
            {!isUndone && (
              <button
                onClick={() => void undo(n.eventId)}
                className="underline-offset-2 transition-colors duration-[var(--dur-fast)] hover:text-fg hover:underline"
              >
                Undo
              </button>
            )}
            {failed === n.eventId && <span role="alert">Couldn&apos;t undo.</span>}
          </li>
        );
      })}
    </ul>
  );
}
