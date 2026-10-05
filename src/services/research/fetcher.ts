import dns from "node:dns";
import { Agent, fetch as undiciFetch } from "undici";
import { UrlRejected, assertFetchableUrl, isPrivateAddress } from "./netguard";

export interface FetchedPage {
  url: string;
  status: number;
  contentType: string;
  html: string;
}

export interface PageFetcher {
  fetch(url: string, signal?: AbortSignal): Promise<FetchedPage>;
}

export class FetchError extends Error {
  constructor(
    readonly code: "rejected" | "http" | "unsupported" | "too_large" | "timeout" | "network",
    message: string,
  ) {
    super(message);
  }
}

export const MAX_BYTES = 1_500_000;
export const MAX_REDIRECTS = 4;
const TIMEOUT_MS = 10_000;

type Lookup = (hostname: string, options: dns.LookupOptions, cb: (err: Error | null, address: string | dns.LookupAddress[], family?: number) => void) => void;

/**
 * DNS lookup that refuses private addresses. Running the check inside the connection's own lookup
 * (rather than resolving separately first) means a hostname can't resolve to a public address for
 * the check and a private one for the connection (DNS rebinding).
 */
export function makeGuardedLookup(resolve: typeof dns.lookup = dns.lookup): Lookup {
  return (hostname, options, cb) => {
  resolve(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return cb(err, "", 4);
    const list = addresses as unknown as dns.LookupAddress[];
    if (!list.length || list.some((a) => isPrivateAddress(a.address))) return cb(new UrlRejected("Address is not public"), "", 4);
    if (options.all) return cb(null, list);
    cb(null, list[0].address, list[0].family);
  });
  };
}

export const guardedLookup = makeGuardedLookup();

const textual = /^(text\/html|application\/xhtml\+xml|text\/plain)/i;

/**
 * Fetches a public web page: http(s) only, public addresses only (checked at connect time and on every
 * redirect), size and time limited. PDFs and other binary types are refused rather than guessed at.
 */
export function createSafeFetcher(opts: { lookup?: Lookup } = {}): PageFetcher {
  const agent = new Agent({ connect: { lookup: (opts.lookup ?? guardedLookup) as never }, headersTimeout: TIMEOUT_MS, bodyTimeout: TIMEOUT_MS });

  return {
    async fetch(raw, signal) {
      let current = assertFetchableUrl(raw).toString();
      for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
        let res;
        try {
          res = await undiciFetch(current, {
            dispatcher: agent,
            redirect: "manual",
            signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)]) : AbortSignal.timeout(TIMEOUT_MS),
            headers: { "user-agent": "Mozilla/5.0 (compatible; CofounderResearch/1.0)", accept: "text/html,application/xhtml+xml,text/plain;q=0.9" },
          });
        } catch (err) {
          const cause = (err as { cause?: unknown })?.cause;
          if (err instanceof UrlRejected || cause instanceof UrlRejected) throw new FetchError("rejected", "Address is not public");
          if ((err as Error)?.name === "TimeoutError") throw new FetchError("timeout", "Timed out");
          throw new FetchError("network", "Couldn't connect");
        }

        if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
          await res.body?.cancel();
          try {
            current = assertFetchableUrl(new URL(res.headers.get("location")!, current).toString()).toString();
          } catch (e) {
            throw new FetchError("rejected", e instanceof UrlRejected ? e.message : "Bad redirect");
          }
          continue;
        }
        if (!res.ok) {
          await res.body?.cancel();
          throw new FetchError("http", `HTTP ${res.status}`);
        }
        const contentType = res.headers.get("content-type") ?? "";
        if (!textual.test(contentType)) {
          await res.body?.cancel();
          throw new FetchError("unsupported", "Not a web page");
        }
        const declared = Number(res.headers.get("content-length") ?? 0);
        if (declared > MAX_BYTES) {
          await res.body?.cancel();
          throw new FetchError("too_large", "Page too large");
        }
        const reader = res.body?.getReader();
        const chunks: Uint8Array[] = [];
        let total = 0;
        while (reader) {
          const { done, value } = await reader.read();
          if (done) break;
          total += value.byteLength;
          if (total > MAX_BYTES) {
            await reader.cancel();
            throw new FetchError("too_large", "Page too large");
          }
          chunks.push(value);
        }
        return { url: current, status: res.status, contentType, html: Buffer.concat(chunks).toString("utf8") };
      }
      throw new FetchError("rejected", "Too many redirects");
    },
  };
}
