"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ContextPanel } from "@/components/context/ContextPanel";
import { ItemPanel } from "@/components/memory/ItemPanel";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { MEMORY_CHANGED, api, notifyMemoryChanged, timeAgo } from "@/lib/memoryClient";
import type { CompetitorView, ResearchFindingView, ResearchOverview } from "@/services/memory/view";

type Open = { type: "finding" | "competitor"; id: string } | null;

function CompetitorPanel({ competitor, onDeleted }: { competitor: CompetitorView; onDeleted: () => void }) {
  return (
    <div className="space-y-5">
      <h3 className="text-[length:var(--fs-xl)] font-semibold">{competitor.company}</h3>
      <p className="text-xs text-muted">Researched {timeAgo(competitor.lastResearched)}. Each fact below was quoted from the page listed under it.</p>
      {competitor.fields.map((f) => (
        <section key={f.key} aria-label={f.label}>
          <h4 className="text-sm font-medium">{f.label}</h4>
          <p className="mt-0.5 text-sm">{f.value}</p>
          <ul className="mt-1 space-y-1">
            {f.sources.map((s, i) => (
              <li key={i} className="text-xs text-muted">
                <a href={s.url} target="_blank" rel="noopener noreferrer" className="text-accent underline underline-offset-2">
                  {s.publisher}
                </a>{" "}
                · read {s.fetchedAt.slice(0, 10)}
                <span className="block border-l-2 border-line pl-2">“{s.quote}”</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
      <Button
        variant="ghost"
        onClick={() => {
          if (!window.confirm(`Remove ${competitor.company} from your competitors?`)) return;
          void api("DELETE", `/api/competitors/${competitor.id}`).then(() => {
            notifyMemoryChanged();
            onDeleted();
          });
        }}
      >
        Remove
      </Button>
    </div>
  );
}

export function ResearchPage({ initial }: { initial: ResearchOverview }) {
  const router = useRouter();
  const [data, setData] = useState(initial);
  const [open, setOpen] = useState<Open>(null);
  const [ask, setAsk] = useState("");

  const reload = useCallback(async () => {
    try {
      setData(await api<ResearchOverview>("GET", "/api/research"));
    } catch {
      /* keep what we have */
    }
  }, []);
  useEffect(() => {
    window.addEventListener(MEMORY_CHANGED, reload);
    return () => window.removeEventListener(MEMORY_CHANGED, reload);
  }, [reload]);

  const groups = new Map<string, ResearchFindingView[]>();
  for (const f of data.findings) groups.set(f.question, [...(groups.get(f.question) ?? []), f]);
  const competitor = open?.type === "competitor" ? data.competitors.find((c) => c.id === open.id) : undefined;
  const summaryOf = (c: CompetitorView) => c.fields.filter((f) => ["pricing", "targetCustomer"].includes(f.key)).map((f) => `${f.label}: ${f.value}`).join(" · ");

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-[720px] px-4 pb-24 pt-16">
        <h1 className="text-[length:var(--fs-2xl)] font-semibold tracking-tight">Research</h1>
        <p className="mt-1 text-sm text-muted">What has been looked up, and where it came from. Nothing is saved unless its quote was found on the page.</p>

        <form
          className="mt-8 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (ask.trim()) router.push(`/?ask=${encodeURIComponent(`Research this for me: ${ask.trim()}`)}`);
          }}
        >
          <Input aria-label="What should we research?" placeholder="What should we research? e.g. what do campus scheduling apps charge" value={ask} maxLength={300} onChange={(e) => setAsk(e.target.value)} />
          <Button type="submit" disabled={!ask.trim()}>
            Ask
          </Button>
        </form>

        <section className="mt-10" aria-labelledby="findings-heading">
          <h2 id="findings-heading" className="text-[length:var(--fs-xl)] font-semibold">
            Findings
          </h2>
          {groups.size === 0 && <p className="mt-2 text-sm text-muted">Nothing yet. Ask a question above, or ask in chat: “who are our competitors and what do they charge?”</p>}
          {[...groups.entries()].map(([question, list]) => (
            <div key={question} className="mt-5">
              <h3 className="px-3 text-sm font-medium">{question}</h3>
              <ul className="mt-1">
                {list.map((f) => (
                  <li key={f.id}>
                    <button onClick={() => setOpen({ type: "finding", id: f.id })} className="flex w-full flex-col items-start rounded-md px-3 py-2.5 text-left transition-colors duration-[var(--dur-fast)] hover:bg-surface-2">
                      <span className="text-[length:var(--fs-base)]">{f.title}</span>
                      <span className="text-xs text-muted">
                        {f.confidence} confidence · {[...new Set(f.sources.map((s) => s.publisher))].join(", ") || "no source"} · {timeAgo(f.createdAt)}
                      </span>
                      {f.implication && <span className="mt-0.5 text-sm text-muted">{f.implication}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>

        <section className="mt-12" aria-labelledby="competitors-heading">
          <h2 id="competitors-heading" className="text-[length:var(--fs-xl)] font-semibold">
            Competitors
          </h2>
          {data.competitors.length === 0 && <p className="mt-2 text-sm text-muted">None recorded. Ask who your competitors are and what they charge.</p>}
          <ul className="mt-2">
            {data.competitors.map((c) => (
              <li key={c.id}>
                <button onClick={() => setOpen({ type: "competitor", id: c.id })} className="flex w-full flex-col items-start rounded-md px-3 py-2.5 text-left transition-colors duration-[var(--dur-fast)] hover:bg-surface-2">
                  <span className="text-[length:var(--fs-base)] font-medium">{c.company}</span>
                  <span className="text-sm text-muted">{summaryOf(c) || `${c.fields.length} facts recorded`}</span>
                  <span className="text-xs text-muted">researched {timeAgo(c.lastResearched)}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <ContextPanel open={open !== null} onClose={() => setOpen(null)} title={open?.type === "competitor" ? "Competitor" : "Finding"}>
        {open?.type === "finding" && (
          <ItemPanel key={open.id} itemId={open.id} onChanged={() => void reload()} onDeleted={() => { setOpen(null); void reload(); }} />
        )}
        {competitor && <CompetitorPanel key={competitor.id} competitor={competitor} onDeleted={() => { setOpen(null); void reload(); }} />}
      </ContextPanel>
    </div>
  );
}
