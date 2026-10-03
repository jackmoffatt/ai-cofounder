"use client";

import { useEffect, useState } from "react";
import { MEMORY_CHANGED } from "./memoryClient";

/** Number of suggested changes waiting for the founder's decision. Refreshes when memory changes. */
export function usePendingProposals(): number {
  const [count, setCount] = useState(0);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const bump = () => setVersion((v) => v + 1);
    window.addEventListener(MEMORY_CHANGED, bump);
    return () => window.removeEventListener(MEMORY_CHANGED, bump);
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/proposals?status=pending")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => !cancelled && j && setCount(j.proposals.length))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [version]);

  return count;
}
