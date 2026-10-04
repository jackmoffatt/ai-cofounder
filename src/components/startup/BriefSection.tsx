"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Markdown } from "@/components/chat/Markdown";
import { Button } from "@/components/ui/Button";
import { api, timeAgo } from "@/lib/memoryClient";
import type { BriefOverview, BriefView } from "@/services/brief/view";

/** The co-founder's own running summary of the company, plus the one thing it recommends doing next. */
export function BriefSection({ initial }: { initial: BriefOverview }) {
  const router = useRouter();
  const [overview, setOverview] = useState(initial);
  const [shown, setShown] = useState<BriefView | null>(initial.brief);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const latest = overview.brief;
  const viewingOld = shown && latest && shown.version !== latest.version;

  async function refresh() {
    setBusy(true);
    setError(null);
    try {
      const r = await api<BriefOverview>("POST", "/api/brief");
      setOverview(r);
      setShown(r.brief);
    } catch (e) {
      setError(e instanceof Error && e.message.length > 3 ? e.message : "Couldn't refresh the brief.");
    } finally {
      setBusy(false);
    }
  }

  async function pick(version: number) {
    if (latest && version === latest.version) return setShown(latest);
    try {
      setShown((await api<{ brief: BriefView }>("GET", `/api/brief?version=${version}`)).brief);
    } catch {
      setError("Couldn't load that version.");
    }
  }

  return (
    <section aria-labelledby="brief-heading" className="mt-10">
      <div className="flex items-baseline justify-between gap-4">
        <h2 id="brief-heading" className="text-[length:var(--fs-xl)] font-semibold">
          Brief
        </h2>
        <div className="flex items-center gap-3 text-xs text-muted">
          {shown && (
            <span>
              {viewingOld ? "Older version" : "Updated"} {timeAgo(shown.createdAt)} · v{shown.version}
              {!viewingOld && overview.stale ? " · out of date" : ""}
            </span>
          )}
          <Button variant="ghost" className="h-7 px-2 text-xs" disabled={busy} onClick={() => void refresh()}>
            {busy ? "Writing…" : latest ? "Refresh" : "Write brief"}
          </Button>
        </div>
      </div>

      {latest?.nextAction && !viewingOld && (
        <div className="mt-4 rounded-lg bg-surface-2 p-4">
          <p className="text-xs uppercase tracking-wider text-muted">Recommended next action</p>
          <p className="mt-1 text-[length:var(--fs-base)] font-medium">{latest.nextAction.action}</p>
          {latest.nextAction.why && <p className="mt-1 text-sm text-muted">{latest.nextAction.why}</p>}
        </div>
      )}

      {shown ? (
        <div className="mt-4 text-[length:var(--fs-base)]">
          <Markdown refs={shown.refs} onOpenRef={(id) => router.push(`/memory?item=${id}`)}>
            {shown.content}
          </Markdown>
        </div>
      ) : (
        <p className="mt-3 text-sm text-muted">
          No brief yet. It&apos;s written once there&apos;s something to summarise, and kept up to date as you work. It&apos;s what
          your co-founder rereads before every conversation.
        </p>
      )}

      {overview.versions.length > 1 && (
        <label className="mt-4 block text-xs text-muted">
          History
          <select
            className="ml-2 h-7 rounded-md border border-line bg-surface px-2 text-xs"
            value={shown?.version ?? ""}
            onChange={(e) => void pick(Number(e.target.value))}
          >
            {overview.versions.map((v) => (
              <option key={v.version} value={v.version}>
                v{v.version} · {timeAgo(v.createdAt)} · {v.reason}
              </option>
            ))}
          </select>
        </label>
      )}
      {error && (
        <p role="alert" className="mt-2 text-sm text-muted">
          {error}
        </p>
      )}
    </section>
  );
}
