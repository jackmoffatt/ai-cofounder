import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
      <h1 className="text-[length:var(--fs-xl)] font-semibold">Not found</h1>
      <p className="max-w-md text-sm text-muted">That conversation or page doesn&apos;t exist (it may have been deleted).</p>
      <Link href="/" className="text-sm text-accent underline underline-offset-2">
        Back to a new chat
      </Link>
    </div>
  );
}
