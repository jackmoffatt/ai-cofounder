"use client";

import { Button } from "@/components/ui/Button";

/** Shown when a page fails to load. Deliberately says little: details belong in the server log. */
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-[length:var(--fs-xl)] font-semibold">Something went wrong</h1>
      <p className="max-w-md text-sm text-muted">
        This page couldn&apos;t load. Your data is safe. If it keeps happening, check that the app can open its database (see docs/RUNNING.md) and look at the terminal where the server is running.
        {error.digest && <span className="mt-2 block text-xs">Reference: {error.digest}</span>}
      </p>
      <Button variant="primary" onClick={reset}>
        Try again
      </Button>
    </div>
  );
}
