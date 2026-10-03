"use client";

import { useCallback, useEffect, useState } from "react";
import { ContextPanel } from "@/components/context/ContextPanel";
import { Input } from "@/components/ui/Input";
import { cn } from "@/lib/cn";
import { KIND_LABELS, type ItemKind } from "@/lib/memory";
import { MEMORY_CHANGED, api, notifyMemoryChanged } from "@/lib/memoryClient";
import type { ItemView, ProposalCard } from "@/services/memory/view";
import { ItemPanel } from "./ItemPanel";
import { ProposalCardView } from "./ProposalCardView";

type Tab = ItemKind | "proposals";
const TABS: Tab[] = ["proposals", "assumption", "decision", "question", "idea", "insight"];
const tabLabel = (t: Tab) => (t === "proposals" ? "Suggested changes" : KIND_LABELS[t].plural);

export function MemoryPage({
  initialItems,
  initialProposals,
  initialItemId,
}: {
  initialItems: ItemView[];
  initialProposals: ProposalCard[];
  initialItemId: string | null;
}) {
  const [items, setItems] = useState(initialItems);
  const [proposals, setProposals] = useState(initialProposals);
  const [tab, setTab] = useState<Tab>(
    initialItemId ? (initialItems.find((i) => i.id === initialItemId)?.kind ?? "assumption") : initialProposals.length ? "proposals" : "assumption",
  );
  const [openId, setOpenId] = useState<string | null>(initialItemId);
  const [newTitle, setNewTitle] = useState("");
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const [i, p] = await Promise.all([
        api<{ items: ItemView[] }>("GET", "/api/memory/items"),
        api<{ proposals: ProposalCard[] }>("GET", "/api/proposals?status=pending"),
      ]);
      setItems(i.items);
      setProposals(p.proposals);
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
    window.history.replaceState(null, "", id ? `/memory?item=${id}` : "/memory");
  }

  async function add() {
    if (!newTitle.trim() || tab === "proposals") return;
    setError(null);
    try {
      const r = await api<{ item: { id: string } }>("POST", "/api/memory/items", { kind: tab, title: newTitle });
      setNewTitle("");
      notifyMemoryChanged();
      open(r.item.id);
    } catch {
      setError("Couldn't add that. Try again.");
    }
  }

  const shown = tab === "proposals" ? [] : items.filter((i) => i.kind === tab);
  const counts = (t: Tab) => (t === "proposals" ? proposals.length : items.filter((i) => i.kind === t).length);

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-[720px] px-4 pb-24 pt-16">
        <h1 className="text-[length:var(--fs-2xl)] font-semibold tracking-tight">Memory</h1>
        <p className="mt-1 text-sm text-muted">
          What your co-founder has recorded, and why. Beliefs stay labelled as beliefs until evidence says otherwise.
        </p>

        <nav aria-label="Memory sections" className="mt-8 flex flex-wrap gap-x-5 gap-y-1 border-b border-line">
          {TABS.filter((t) => t !== "proposals" || proposals.length > 0 || tab === "proposals").map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              aria-current={tab === t ? "page" : undefined}
              className={cn(
                "-mb-px border-b-2 pb-2 text-sm transition-colors duration-[var(--dur-fast)]",
                tab === t ? "border-fg text-fg" : "border-transparent text-muted hover:text-fg",
              )}
            >
              {tabLabel(t)}
              {counts(t) > 0 && <span className="ml-1.5 text-xs text-muted">{counts(t)}</span>}
            </button>
          ))}
        </nav>

        {tab === "proposals" ? (
          <div className="mt-4">
            {proposals.length === 0 ? (
              <p className="text-sm text-muted">Nothing waiting. Suggested changes to your startup show up here and in chat.</p>
            ) : (
              proposals.map((p) => <ProposalCardView key={p.id} proposal={p} onChange={() => void reload()} />)
            )}
          </div>
        ) : (
          <>
            <ul className="mt-2">
              {shown.length === 0 && <li className="py-4 text-sm text-muted">Nothing here yet.</li>}
              {shown.map((i) => (
                <li key={i.id}>
                  <button
                    onClick={() => open(i.id)}
                    className="flex w-full flex-col items-start rounded-md px-3 py-2.5 text-left transition-colors duration-[var(--dur-fast)] hover:bg-surface-2"
                  >
                    <span className="text-[length:var(--fs-base)]">{i.title}</span>
                    <span className="text-xs text-muted">
                      {i.status}
                      {i.kind === "assumption" && ` · ${i.confidence} confidence · ${i.evidenceCount === 0 ? "no evidence" : `${i.evidenceCount} evidence`}`}
                      {" · "}
                      {i.createdBy === "agent" ? "from chat" : "added by you"}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            <form
              className="mt-3 flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void add();
              }}
            >
              <Input
                aria-label={`Add ${KIND_LABELS[tab].singular.toLowerCase()}`}
                placeholder={`Add ${KIND_LABELS[tab].singular.toLowerCase()}…`}
                value={newTitle}
                maxLength={300}
                onChange={(e) => setNewTitle(e.target.value)}
              />
            </form>
            {error && <p role="alert" className="mt-2 text-sm text-muted">{error}</p>}
          </>
        )}
      </div>

      <ContextPanel open={openId !== null} onClose={() => open(null)} title="Details">
        {openId && <ItemPanel key={openId} itemId={openId} onChanged={() => void reload()} onDeleted={() => { open(null); void reload(); }} />}
      </ContextPanel>
    </div>
  );
}

