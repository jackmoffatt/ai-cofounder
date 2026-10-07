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

/**
 * Hosts this local app answers to. A page on another website can't read this app's responses directly,
 * but with DNS rebinding it can make its own domain resolve to 127.0.0.1 and then both the Origin and
 * the Host it sends are its own. Refusing any Host that isn't a loopback name closes that route.
 * Add names (e.g. a tailnet hostname) with ALLOWED_HOSTS="name1,name2".
 */
export function isAllowedHost(hostHeader: string | null, extra: string = process.env.ALLOWED_HOSTS ?? ""): boolean {
  if (!hostHeader) return false;
  const host = hostHeader.toLowerCase().replace(/:\d+$/, "").replace(/^\[|\]$/g, "");
  if (host === "localhost" || host === "127.0.0.1" || host === "::1") return true;
  return extra
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean)
    .includes(host);
}
