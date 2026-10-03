"use client";

import Link from "next/link";
import { useState } from "react";
import { notifyMemoryChanged } from "@/lib/memoryClient";

export interface MemoryNote {
  eventId: string;
  summary: string;
  reason: string;
  undone: boolean;
  /** Set for memory items (assumptions, decisions…), which have a page in Memory. */
  itemId?: string;
}

/** Quiet, expandable-on-hover line showing what was saved to the founder profile, with undo. */
export function MemoryNotes({ notes }: { notes: MemoryNote[] }) {
  const [undone, setUndone] = useState<Set<string>>(() => new Set(notes.filter((n) => n.undone).map((n) => n.eventId)));
  const [failed, setFailed] = useState<string | null>(null);

  async function undo(id: string) {
    setFailed(null);
    const res = await fetch(`/api/memory/events/${id}/undo`, { method: "POST" });
    if (res.ok) {
      setUndone((prev) => new Set(prev).add(id));
      notifyMemoryChanged();
    }
    else setFailed(id);
  }

  return (
    <ul className="mt-2 space-y-0.5 text-xs text-muted" aria-label="Saved to memory">
      {notes.map((n) => {
        const isUndone = undone.has(n.eventId);
        return (
          <li key={n.eventId} className="flex items-baseline gap-2" title={n.reason ? `From: “${n.reason}”` : undefined}>
            <span className={isUndone ? "line-through opacity-60" : undefined}>
              {isUndone ? "Removed from" : "Saved to"} {n.itemId ? "memory" : "your profile"} ·{" "}
              {n.itemId && !isUndone ? (
                <Link href={`/memory?item=${n.itemId}`} className="underline-offset-2 hover:text-fg hover:underline">
                  {n.summary}
                </Link>
              ) : (
                n.summary
              )}
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
