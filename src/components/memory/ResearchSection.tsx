"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { api, notifyMemoryChanged, timeAgo } from "@/lib/memoryClient";
import type { ItemDetail, ItemView } from "@/services/memory/view";

const selectClass = "mt-1 block h-8 w-full rounded-md border border-line bg-surface px-2 text-sm focus:border-accent focus:outline-none";

/** A research finding: what was found, where, the exact quote, and a way to use it as evidence. */
export function ResearchSection({ item }: { item: ItemDetail }) {
  const [assumptions, setAssumptions] = useState<ItemView[]>([]);
  const [form, setForm] = useState({ assumptionId: "", stance: "supports", strength: "anecdotal" });
  const [status, setStatus] = useState<"idle" | "saved" | "error">("idle");

  useEffect(() => {
    let cancelled = false;
    api<{ items: ItemView[] }>("GET", "/api/memory/items?kind=assumption")
      .then((r) => !cancelled && setAssumptions(r.items.filter((a) => a.status !== "rejected")))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const publishers = [...new Set(item.sources.map((s) => s.publisher))];
  const implication = String(item.data.implication ?? item.body ?? "");

  return (
    <div className="space-y-5">
      <p className="text-sm text-muted">
        {item.confidence} confidence · {item.sources.length === 0 ? "no source on file" : `${publishers.length} source${publishers.length === 1 ? "" : "s"}`} · researched {timeAgo(item.createdAt)}
      </p>
      {item.researchQuestion && <p className="text-sm text-muted">Question: {item.researchQuestion}</p>}
      {implication && (
        <section aria-label="What it means">
          <h3 className="text-sm font-medium">What it might mean</h3>
          <p className="mt-1 text-sm">{implication}</p>
          <p className="text-xs text-muted">That&apos;s the co-founder&apos;s interpretation, not something the pages say.</p>
        </section>
      )}

      <section aria-label="Sources">
        <h3 className="text-sm font-medium">Sources</h3>
        <ul className="mt-2 space-y-3">
          {item.sources.map((s) => (
            <li key={s.sourceId} className="text-sm">
              <a href={s.url} target="_blank" rel="noopener noreferrer" className="text-accent underline underline-offset-2">
                {s.publisher}
              </a>
              <span className="text-xs text-muted"> · read {s.fetchedAt.slice(0, 10)}</span>
              <p className="truncate text-xs text-muted">{s.title}</p>
              <blockquote className="mt-1 border-l-2 border-line pl-3 text-muted">“{s.quote}”</blockquote>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-muted">Every quote was checked against the page text when this was saved. Pages change: check the source before relying on it.</p>
      </section>

      <section aria-label="Use as evidence">
        <h3 className="text-sm font-medium">Use as evidence</h3>
        {assumptions.length === 0 ? (
          <p className="mt-1 text-sm text-muted">No assumptions to attach this to yet.</p>
        ) : (
          <form
            className="mt-2 space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!form.assumptionId) return;
              setStatus("idle");
              api("POST", `/api/memory/items/${item.id}/attach`, form)
                .then(() => {
                  setStatus("saved");
                  notifyMemoryChanged();
                })
                .catch(() => setStatus("error"));
            }}
          >
            <select aria-label="Assumption" className={selectClass} value={form.assumptionId} onChange={(e) => setForm({ ...form, assumptionId: e.target.value })}>
              <option value="">Choose an assumption…</option>
              {assumptions.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.title.slice(0, 70)}
                </option>
              ))}
            </select>
            <div className="grid grid-cols-2 gap-2">
              <select aria-label="Stance" className={selectClass} value={form.stance} onChange={(e) => setForm({ ...form, stance: e.target.value })}>
                <option value="supports">Supports it</option>
                <option value="weakens">Weakens it</option>
              </select>
              <select aria-label="Strength" className={selectClass} value={form.strength} onChange={(e) => setForm({ ...form, strength: e.target.value })}>
                <option value="anecdotal">Anecdotal</option>
                <option value="moderate">Moderate</option>
              </select>
            </div>
            <Button type="submit" disabled={!form.assumptionId}>
              Attach as evidence
            </Button>
            {status === "saved" && <p className="text-sm text-muted">Attached. The assumption now counts it.</p>}
            {status === "error" && (
              <p role="alert" className="text-sm text-muted">
                Couldn&apos;t attach that.
              </p>
            )}
          </form>
        )}
      </section>
    </div>
  );
}
