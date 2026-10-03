export const MEMORY_CHANGED = "memory:changed";
/** Tells other parts of the UI (sidebar badge, lists) that memory or proposals changed. */
export const notifyMemoryChanged = () => window.dispatchEvent(new Event(MEMORY_CHANGED));

export async function api<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const msg = (await res.json().catch(() => null))?.error;
    throw new Error(typeof msg === "string" ? msg : String(res.status));
  }
  return res.json();
}

export const timeAgo = (iso: string): string => {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
};
