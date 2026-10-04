"use client";

import { useCallback, useEffect, useState } from "react";
import { ContextPanel } from "@/components/context/ContextPanel";
import { ItemPanel } from "@/components/memory/ItemPanel";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { MEMORY_CHANGED, api, notifyMemoryChanged, timeAgo } from "@/lib/memoryClient";
import type { ItemView } from "@/services/memory/view";

const reasoningOf = (i: ItemView) => String(i.data.reasoning ?? i.body ?? "");

function DecisionRow({ d, onOpen }: { d: ItemView; onOpen: () => void }) {
  const why = reasoningOf(d);
  return (
    <li>
      <button onClick={onOpen} className="flex w-full flex-col items-start rounded-md px-3 py-2.5 text-left transition-colors duration-[var(--dur-fast)] hover:bg-surface-2">
        <span className="text-[length:var(--fs-base)]">{d.title}</span>
        {why && <span className="mt-0.5 line-clamp-2 text-sm text-muted">{why}</span>}
        <span className="mt-0.5 text-xs text-muted">
          {d.status !== "active" ? `${d.status} · ` : ""}
          {timeAgo(d.createdAt)} · {d.createdBy === "agent" ? "from chat" : "added by you"}
        </span>
      </button>
    </li>
  );
}

/** A record of what was decided and why, so months later "why did we do this?" has an answer. */
export function DecisionsPage({ initialItems, initialItemId }: { initialItems: ItemView[]; initialItemId: string | null }) {
  const [items, setItems] = useState(initialItems);
  const [openId, setOpenId] = useState<string | null>(initialItemId);
  const [form, setForm] = useState({ title: "", reasoning: "" });
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const r = await api<{ items: ItemView[] }>("GET", "/api/memory/items?kind=decision");
      setItems(r.items);
    } catch {
      /* keep what we have */
    }
  }, []);
  useEffect(() => {
    window.addEventListener(MEMORY_CHANGED, reload);
    return () => window.removeEventListener(MEMORY_CHANGED, reload);
  }, [reload]);

  function open(id: string | null) {
    setOpenId(id);
    window.history.replaceState(null, "", id ? `/decisions?item=${id}` : "/decisions");
  }

  async function add() {
    if (!form.title.trim()) return;
    setError(null);
    try {
      const r = await api<{ item: { id: string } }>("POST", "/api/memory/items", {
        kind: "decision",
        title: form.title,
        body: form.reasoning,
        data: { reasoning: form.reasoning },
      });
      setForm({ title: "", reasoning: "" });
      notifyMemoryChanged();
      open(r.item.id);
    } catch {
      setError("Couldn't save that. Try again.");
    }
  }

  const active = items.filter((i) => i.status === "active");
  const other = items.filter((i) => i.status !== "active");

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-[720px] px-4 pb-24 pt-16">
        <h1 className="text-[length:var(--fs-2xl)] font-semibold tracking-tight">Decisions</h1>
        <p className="mt-1 text-sm text-muted">What was decided, and why. The reasoning matters more than the choice.</p>

        <form
          className="mt-8 space-y-2 rounded-lg bg-surface-2 p-4"
          onSubmit={(e) => {
            e.preventDefault();
            void add();
          }}
        >
          <Input aria-label="Decision" placeholder="We decided to…" value={form.title} maxLength={300} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          <textarea
            aria-label="Why"
            placeholder="Why? What else did you consider?"
            rows={2}
            value={form.reasoning}
            onChange={(e) => setForm({ ...form, reasoning: e.target.value })}
            className="block w-full resize-none rounded-md border border-line bg-surface px-3 py-2 text-sm focus:border-accent focus:outline-none"
          />
          <Button type="submit" disabled={!form.title.trim()}>
            Record decision
          </Button>
          {error && (
            <p role="alert" className="text-sm text-muted">
              {error}
            </p>
          )}
        </form>

        <ul className="mt-6">
          {active.length === 0 && <li className="px-3 py-2 text-sm text-muted">No decisions recorded yet. Decisions you state in chat appear here.</li>}
          {active.map((d) => (
            <DecisionRow key={d.id} d={d} onOpen={() => open(d.id)} />
          ))}
        </ul>

        {other.length > 0 && (
          <section className="mt-8">
            <h2 className="px-3 text-[11px] font-medium uppercase tracking-wider text-muted">Replaced or reversed</h2>
            <ul className="mt-1">
              {other.map((d) => (
                <DecisionRow key={d.id} d={d} onOpen={() => open(d.id)} />
              ))}
            </ul>
          </section>
        )}
      </div>

      <ContextPanel open={openId !== null} onClose={() => open(null)} title="Decision">
        {openId && (
          <ItemPanel
            key={openId}
            itemId={openId}
            onChanged={() => void reload()}
            onDeleted={() => {
              open(null);
              void reload();
            }}
          />
        )}
      </ContextPanel>
    </div>
  );
}
