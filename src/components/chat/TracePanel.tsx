"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/memoryClient";
import type { TraceView } from "@/services/brief/view";

/** What the agent saw and did for one reply. Developer-facing; shows no hidden reasoning. */
export function TracePanel({ messageId }: { messageId: string }) {
  const [trace, setTrace] = useState<TraceView | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api<{ trace: TraceView }>("GET", `/api/traces/${messageId}`)
      .then((r) => !cancelled && setTrace(r.trace))
      .catch(() => !cancelled && setError(true));
    return () => {
      cancelled = true;
    };
  }, [messageId]);

  if (error) return <p className="text-sm text-muted">No trace for this message.</p>;
  if (!trace) return <p className="text-sm text-muted">Loading…</p>;
  const c = trace.context;

  return (
    <div className="space-y-5 text-sm">
      <section>
        <h3 className="font-medium">Intent</h3>
        <p className="mt-1 text-muted">
          {c.intent.mode} · via {c.intent.source}
          {c.intent.recall ? " · recall" : ""}
        </p>
        {c.intent.keywords.length > 0 && <p className="text-muted">Keywords: {c.intent.keywords.join(", ")}</p>}
      </section>

      <section>
        <h3 className="font-medium">Context sent</h3>
        <table className="mt-1 w-full text-left text-muted">
          <tbody>
            {c.sections.map((s) => (
              <tr key={s.name}>
                <td className="py-0.5 pr-4">{s.name}</td>
                <td className="py-0.5 text-right tabular-nums">{s.tokens.toLocaleString()}</td>
              </tr>
            ))}
            <tr className="text-fg">
              <td className="pt-1 pr-4">estimated total</td>
              <td className="pt-1 text-right tabular-nums">{c.totalTokens.toLocaleString()}</td>
            </tr>
          </tbody>
        </table>
        <p className="mt-1 text-xs text-muted">
          {c.historyMessages} messages sent · {c.summarizedMessages} covered by summary · brief {c.briefVersion ? `v${c.briefVersion}` : "none yet"}
        </p>
      </section>

      <section>
        <h3 className="font-medium">Retrieved memory ({c.items.length})</h3>
        {c.items.length === 0 ? (
          <p className="mt-1 text-muted">Nothing relevant was stored.</p>
        ) : (
          <ul className="mt-1 space-y-1">
            {c.items.map((i) => (
              <li key={i.id} className="text-muted">
                <span className="text-fg">{i.title}</span> · {i.kind} · {i.status} · {i.reason === "keyword" ? "matched keywords" : i.reason}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3 className="font-medium">Model</h3>
        <p className="mt-1 text-muted">
          {trace.model || "unknown"} · {trace.tokensIn.toLocaleString()} in / {trace.tokensOut.toLocaleString()} out ·{" "}
          {(trace.latencyMs / 1000).toFixed(1)}s
        </p>
      </section>

      <section>
        <h3 className="font-medium">Memory written</h3>
        {trace.memoryChanges.length + trace.proposals.length === 0 ? (
          <p className="mt-1 text-muted">Nothing.</p>
        ) : (
          <ul className="mt-1 space-y-1 text-muted">
            {trace.memoryChanges.map((m) => (
              <li key={m}>Saved: {m}</li>
            ))}
            {trace.proposals.map((m) => (
              <li key={m}>Suggested: {m}</li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
