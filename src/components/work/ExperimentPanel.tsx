"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { EditableField } from "@/components/ui/EditableField";
import { EXPERIMENT_STATUSES } from "@/lib/work";
import { api, notifyMemoryChanged } from "@/lib/memoryClient";
import type { ExperimentView } from "@/services/work/view";

const selectClass = "mt-1 block h-8 w-full rounded-md border border-line bg-surface px-2 text-sm focus:border-accent focus:outline-none";

/** One experiment: the hypothesis, how it's tested, and — when it ends — what happened and what it means. */
export function ExperimentPanel({ experiment, onChanged }: { experiment: ExperimentView; onChanged: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState({ result: "", conclusion: "", record: true, stance: "supports", strength: "moderate" });
  const finished = experiment.status === "completed";

  async function run(fn: () => Promise<unknown>) {
    setError(null);
    try {
      await fn();
      onChanged();
      notifyMemoryChanged();
    } catch (e) {
      setError(e instanceof Error && e.message.length > 3 ? e.message : "Couldn't save. Try again.");
    }
  }
  const patch = (p: object) => run(() => api("PATCH", `/api/experiments/${experiment.id}`, p));

  return (
    <div className="space-y-5">
      <EditableField label="Hypothesis" value={experiment.hypothesis} rows={2} onSave={(v) => patch({ hypothesis: v })} />
      <EditableField label="Method" value={experiment.method} rows={2} onSave={(v) => patch({ method: v })} />
      <EditableField label="Success looks like" hint="Decide this before you run it." value={experiment.successCriteria} rows={2} onSave={(v) => patch({ successCriteria: v })} />

      {experiment.assumptionId && (
        <p className="text-sm text-muted">
          Tests:{" "}
          <Link href={`/memory?item=${experiment.assumptionId}`} className="text-accent underline underline-offset-2">
            {experiment.assumptionTitle}
          </Link>
        </p>
      )}

      {!finished && (
        <label className="block text-xs text-muted">
          Status
          <select className={selectClass} value={experiment.status} onChange={(e) => void patch({ status: e.target.value })}>
            {EXPERIMENT_STATUSES.filter((s) => s !== "completed").map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
      )}

      {finished ? (
        <section aria-label="Outcome" className="space-y-2 rounded-md bg-surface-2 p-3 text-sm">
          <p className="text-xs uppercase tracking-wider text-muted">Completed</p>
          <p>{experiment.result}</p>
          {experiment.conclusion && <p className="text-muted">Conclusion: {experiment.conclusion}</p>}
        </section>
      ) : (
        <form
          aria-label="Finish experiment"
          className="space-y-2 rounded-md border border-line p-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!done.result.trim()) return;
            void run(() =>
              api("POST", `/api/experiments/${experiment.id}/complete`, {
                result: done.result,
                conclusion: done.conclusion,
                ...(done.record && experiment.assumptionId ? { evidence: { stance: done.stance, strength: done.strength } } : {}),
              }),
            );
          }}
        >
          <p className="text-sm font-medium">Finish this experiment</p>
          <textarea
            aria-label="What happened?"
            placeholder="What happened? e.g. 7 of 10 interviewees brought it up unprompted"
            rows={2}
            value={done.result}
            onChange={(e) => setDone({ ...done, result: e.target.value })}
            className="block w-full resize-none rounded-md border border-line bg-surface px-3 py-2 text-sm focus:border-accent focus:outline-none"
          />
          <textarea
            aria-label="What does it mean?"
            placeholder="What does it mean? What will you do next?"
            rows={2}
            value={done.conclusion}
            onChange={(e) => setDone({ ...done, conclusion: e.target.value })}
            className="block w-full resize-none rounded-md border border-line bg-surface px-3 py-2 text-sm focus:border-accent focus:outline-none"
          />
          {experiment.assumptionId && (
            <>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={done.record} onChange={(e) => setDone({ ...done, record: e.target.checked })} />
                Record the result as evidence on the assumption
              </label>
              {done.record && (
                <div className="grid grid-cols-2 gap-2">
                  <select aria-label="Stance" className={selectClass} value={done.stance} onChange={(e) => setDone({ ...done, stance: e.target.value })}>
                    <option value="supports">Supports it</option>
                    <option value="weakens">Weakens it</option>
                  </select>
                  <select aria-label="Strength" className={selectClass} value={done.strength} onChange={(e) => setDone({ ...done, strength: e.target.value })}>
                    <option value="anecdotal">Anecdotal</option>
                    <option value="moderate">Moderate</option>
                    <option value="strong">Strong</option>
                  </select>
                </div>
              )}
            </>
          )}
          <Button type="submit" variant="primary" disabled={!done.result.trim()}>
            Complete
          </Button>
        </form>
      )}
      {error && (
        <p role="alert" className="text-sm text-muted">
          {error}
        </p>
      )}
    </div>
  );
}
