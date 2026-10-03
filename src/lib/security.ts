/**
 * Guards state-changing routes against requests from other websites (CSRF / DNS rebinding):
 * this is a local app with no login, so any page in the browser could otherwise call it.
 */
export function rejectCrossOrigin(req: Request): Response | null {
  if (req.headers.get("sec-fetch-site") === "cross-site") return forbidden();
  const origin = req.headers.get("origin");
  if (origin) {
    let host: string;
    try {
      host = new URL(origin).host;
    } catch {
      return forbidden();
    }
    if (host !== req.headers.get("host")) return forbidden();
  }
  return null;
}

function forbidden() {
  return Response.json({ error: "Forbidden" }, { status: 403 });
}
