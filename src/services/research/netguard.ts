import net from "node:net";

/**
 * Whether an IP address is somewhere a web fetch must never go: loopback, private ranges, link-local
 * (including cloud metadata at 169.254.169.254), carrier-grade NAT, multicast and reserved space.
 * Fetching arbitrary URLs from a local app is an SSRF risk, so this is checked on every connection.
 */
export function isPrivateAddress(ip: string): boolean {
  const kind = net.isIP(ip);
  if (kind === 4) return isPrivateV4(ip);
  if (kind === 6) return isPrivateV6(ip.toLowerCase());
  return true; // not an IP at all: refuse
}

function isPrivateV4(ip: string): boolean {
  const [a, b] = ip.split(".").map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // CGNAT
    (a === 169 && b === 254) || // link-local, cloud metadata
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) || // IETF protocol assignments / TEST-NET-1
    (a === 198 && (b === 18 || b === 19)) || // benchmarking
    (a === 198 && b === 51) ||
    (a === 203 && b === 0) ||
    a >= 224 // multicast, reserved, broadcast
  );
}

function isPrivateV6(ip: string): boolean {
  if (ip === "::" || ip === "::1") return true;
  // IPv4-mapped / compatible: ::ffff:a.b.c.d or ::ffff:7f00:1
  const mapped = /^(?:::ffff:|::)(\d+\.\d+\.\d+\.\d+)$/.exec(ip);
  if (mapped) return isPrivateV4(mapped[1]);
  const hex = /^(?:::ffff:|::)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(ip);
  if (hex) {
    const hi = parseInt(hex[1], 16);
    const lo = parseInt(hex[2], 16);
    return isPrivateV4(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
  }
  return (
    /^f[cd]/.test(ip) || // unique local fc00::/7
    /^fe[89ab]/.test(ip) || // link-local fe80::/10
    ip.startsWith("ff") || // multicast
    ip.startsWith("64:ff9b:") || // NAT64
    ip.startsWith("2001:db8") // documentation
  );
}

export class UrlRejected extends Error {}

/** Cheap checks before any network activity. Hostnames are resolved and checked again at connect time. */
export function assertFetchableUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UrlRejected("Not a valid URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new UrlRejected("Only http(s) URLs can be fetched");
  if (url.username || url.password) throw new UrlRejected("URLs with credentials are refused");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new UrlRejected("Local addresses are refused");
  }
  if (net.isIP(host) && isPrivateAddress(host)) throw new UrlRejected("Private addresses are refused");
  return url;
}

/** Canonical form for deduplicating URLs: no fragment, no tracking params, no trailing slash. */
export function normalizeUrl(raw: string): string {
  try {
    const u = new URL(raw);
    u.hash = "";
    for (const k of [...u.searchParams.keys()]) if (/^(utm_|fbclid|gclid|mc_)/i.test(k)) u.searchParams.delete(k);
    u.hostname = u.hostname.toLowerCase();
    const s = u.toString();
    return s.length > 1 && s.endsWith("/") && !u.search ? s.slice(0, -1) : s;
  } catch {
    return raw;
  }
}

export const publisherOf = (raw: string): string => {
  try {
    return new URL(raw).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
};
