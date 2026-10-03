"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { api, notifyMemoryChanged } from "@/lib/memoryClient";
import type { ProposalCard } from "@/services/memory/view";

/** A suggested change to the company. Nothing happens until the founder accepts. */
export function ProposalCardView({ proposal, onChange }: { proposal: ProposalCard; onChange?: (p: ProposalCard) => void }) {
  const [current, setCurrent] = useState(proposal);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function decide(action: "accept" | "reject") {
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ proposal: ProposalCard }>("POST", `/api/proposals/${current.id}`, { action });
      setCurrent(res.proposal);
      onChange?.(res.proposal);
      notifyMemoryChanged();
    } catch (e) {
      setError(e instanceof Error && e.message.length > 3 ? e.message : "Couldn't update. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const decided = current.status !== "pending";
  return (
    <div className="animate-message-in mt-3 rounded-lg border border-line bg-surface p-4 text-sm">
      <p className="text-xs uppercase tracking-wider text-muted">
        {decided ? (current.status === "accepted" ? "Accepted" : "Declined") : "Suggested change"}
      </p>
      <p className="mt-1 text-[length:var(--fs-base)]">{current.summary}</p>
      {current.rationale && <p className="mt-1 text-muted">{current.rationale}</p>}
      {!decided && (
        <div className="mt-3 flex gap-2">
          <Button variant="primary" disabled={busy} onClick={() => void decide("accept")}>
            Accept
          </Button>
          <Button variant="ghost" disabled={busy} onClick={() => void decide("reject")}>
            Not now
          </Button>
        </div>
      )}
      {error && (
        <p role="alert" className="mt-2 text-muted">
          {error}
        </p>
      )}
    </div>
  );
}
