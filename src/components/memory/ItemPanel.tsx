"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { EditableField } from "@/components/ui/EditableField";
import { CONFIDENCES, KIND_LABELS, STATUSES } from "@/lib/memory";
import { api, notifyMemoryChanged, timeAgo } from "@/lib/memoryClient";
import type { ItemDetail } from "@/services/memory/view";

const selectClass =
  "mt-1 block h-8 w-full rounded-md border border-line bg-surface px-2 text-sm focus:border-accent focus:outline-none";

/** Everything about one memory item: what it says, why we believe it, where it came from, how it changed. */
export function ItemPanel({ itemId, onDeleted, onChanged }: { itemId: string; onDeleted: () => void; onChanged: () => void }) {
  const [item, setItem] = useState<ItemDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ev, setEv] = useState({ stance: "supports", strength: "moderate", excerpt: "" });

  useEffect(() => {
    let cancelled = false;
    api<{ item: ItemDetail }>("GET", `/api/memory/items/${itemId}`)
      .then((r) => !cancelled && setItem(r.item))
      .catch(() => !cancelled && setError("Couldn't load this item."));
    return () => {
      cancelled = true;
    };
  }, [itemId]);

  async function run<T extends { item?: ItemDetail }>(fn: () => Promise<T>) {
    setError(null);
    try {
      const r = await fn();
      if (r.item) setItem(r.item);
      onChanged();
      notifyMemoryChanged();
    } catch (e) {
      setError(e instanceof Error && e.message.length > 3 ? e.message : "Couldn't save. Try again.");
    }
  }

  if (error && !item) return <p className="text-sm text-muted">{error}</p>;
  if (!item) return <p className="text-sm text-muted">Loading…</p>;

  const patch = (p: object) => run(() => api<{ item: ItemDetail }>("PATCH", `/api/memory/items/${item.id}`, p));
  const isAssumption = item.kind === "assumption";

  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs uppercase tracking-wider text-muted">{KIND_LABELS[item.kind].singular}</p>
        <EditableField label="Statement" value={item.title} rows={2} onSave={async (v) => void (await patch({ title: v }))} />
      </div>

      <div className="grid grid-cols-3 gap-3">
        <label className="text-xs text-muted">
          Status
          <select className={selectClass} value={item.status} onChange={(e) => void patch({ status: e.target.value })}>
            {STATUSES[item.kind].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
        <label className="text-xs text-muted">
          Confidence
          <select className={selectClass} value={item.confidence} onChange={(e) => void patch({ confidence: e.target.value })}>
            {CONFIDENCES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        <label className="text-xs text-muted">
          Importance
          <select className={selectClass} value={item.importance} onChange={(e) => void patch({ importance: Number(e.target.value) })}>
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
        </label>
      </div>
      {isAssumption && (
        <p className="text-xs text-muted">
          Status and confidence follow the evidence below. Validated and rejected are your call: set them yourself once the
          evidence convinces you.
        </p>
      )}

      <EditableField label="Notes" value={item.body} rows={3} onSave={async (v) => void (await patch({ body: v }))} />

      {isAssumption && (
        <section aria-label="Evidence">
          <h3 className="text-sm font-medium">Evidence</h3>
          {item.evidence.length === 0 ? (
            <p className="mt-1 text-sm text-muted">None yet. This is still just a belief.</p>
          ) : (
            <ul className="mt-2 space-y-2">
              {item.evidence.map((e) => (
                <li key={e.id} className="rounded-md bg-surface-2 px-3 py-2 text-sm">
                  <p className="text-xs text-muted">
                    {e.stance === "supports" ? "Supports" : "Weakens"} · {e.strength} · {e.createdBy === "agent" ? "from chat" : "added by you"}
                  </p>
                  <p>{e.excerpt}</p>
                  <button
                    className="mt-1 text-xs text-muted underline-offset-2 hover:text-fg hover:underline"
                    onClick={() => void run(async () => (await api("DELETE", `/api/memory/evidence/${e.id}`), api<{ item: ItemDetail }>("GET", `/api/memory/items/${item.id}`)))}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
          <form
            className="mt-3 space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!ev.excerpt.trim()) return;
              void run(() => api<{ item: ItemDetail }>("POST", `/api/memory/items/${item.id}/evidence`, ev)).then(() =>
                setEv((p) => ({ ...p, excerpt: "" })),
              );
            }}
          >
            <div className="grid grid-cols-2 gap-2">
              <select aria-label="Stance" className={selectClass} value={ev.stance} onChange={(e) => setEv({ ...ev, stance: e.target.value })}>
                <option value="supports">Supports</option>
                <option value="weakens">Weakens</option>
              </select>
              <select aria-label="Strength" className={selectClass} value={ev.strength} onChange={(e) => setEv({ ...ev, strength: e.target.value })}>
                <option value="anecdotal">Anecdotal</option>
                <option value="moderate">Moderate</option>
                <option value="strong">Strong</option>
              </select>
            </div>
            <textarea
              aria-label="What did you observe?"
              placeholder="What did you observe? e.g. 7 of 10 interviewees mentioned it"
              value={ev.excerpt}
              onChange={(e) => setEv({ ...ev, excerpt: e.target.value })}
              rows={2}
              className="block w-full resize-none rounded-md border border-line bg-surface px-3 py-2 text-sm focus:border-accent focus:outline-none"
            />
            <Button type="submit" disabled={!ev.excerpt.trim()}>
              Add evidence
            </Button>
          </form>
        </section>
      )}

      <section aria-label="Source">
        <h3 className="text-sm font-medium">Where this came from</h3>
        <p className="mt-1 text-sm text-muted">
          {item.origin === "manual"
            ? "You added this."
            : item.provenance.conversationId
              ? "Saved from a conversation"
              : "Saved from a conversation that no longer exists"}
          {item.provenance.conversationId && (
            <>
              {": "}
              <Link href={`/c/${item.provenance.conversationId}`} className="text-accent underline underline-offset-2">
                {item.provenance.conversationTitle}
              </Link>
            </>
          )}
          .
        </p>
        {item.provenance.quote && <blockquote className="mt-1 border-l-2 border-line pl-3 text-sm text-muted">“{item.provenance.quote}”</blockquote>}
      </section>

      <section aria-label="History">
        <h3 className="text-sm font-medium">History</h3>
        <ul className="mt-1 space-y-1 text-xs text-muted">
          {item.history.map((h) => (
            <li key={h.id}>
              {timeAgo(h.createdAt)} · {h.actor === "agent" ? "co-founder" : "you"} · {h.summary}
              {h.undoneAt ? " (undone)" : ""}
            </li>
          ))}
        </ul>
      </section>

      {error && (
        <p role="alert" className="text-sm text-muted">
          {error}
        </p>
      )}

      <Button
        variant="ghost"
        onClick={() => {
          if (!window.confirm("Delete this? You can't get it back from the app, but the change stays in the history.")) return;
          void api("DELETE", `/api/memory/items/${item.id}`).then(() => {
            notifyMemoryChanged();
            onDeleted();
          });
        }}
      >
        Delete
      </Button>
    </div>
  );
}
