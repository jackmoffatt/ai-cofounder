import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createDb, type Db } from "@/db/client";
import { getItem, listItems } from "@/db/queries/memory";
import { findFreshSource, listCompetitorRows, listSourcesForItem } from "@/db/queries/research";
import { FakeProvider } from "@/services/ai/fake";
import { parseFieldSources } from "@/services/research/competitors";
import { extractText, selectRelevant } from "@/services/research/extract";
import { FakeFetcher, FakeSearch, FIXTURE_PAGES } from "@/services/research/fake";
import { FetchError, createSafeFetcher, makeGuardedLookup } from "@/services/research/fetcher";
import { runResearch } from "@/services/research/index";
import { UrlRejected, assertFetchableUrl, isPrivateAddress, normalizeUrl } from "@/services/research/netguard";
import { normalizeForMatch, numbersSupported, quoteInText } from "@/services/research/quotes";
import { BraveSearch, SearchError } from "@/services/research/search";
import { synthesize, type PageForSynthesis } from "@/services/research/synthesize";

describe("network guard", () => {
  it("refuses private, loopback, link-local and reserved addresses", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "::1", "fe80::1", "fc00::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:a9fe:a9fe"]) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
    for (const ip of ["8.8.8.8", "93.184.216.34", "172.32.0.1", "2606:4700:4700::1111"]) expect(isPrivateAddress(ip), ip).toBe(false);
    expect(isPrivateAddress("not-an-ip")).toBe(true);
  });

  it("rejects unsafe URLs before any request", () => {
    for (const u of ["file:///etc/passwd", "ftp://example.com/x", "http://user:pw@example.com/", "http://localhost/", "http://foo.localhost/", "http://127.0.0.1:3000/", "http://[::1]/", "http://169.254.169.254/latest/meta-data", "http://10.0.0.5/", "http://db.internal/", "nonsense"]) {
      expect(() => assertFetchableUrl(u), u).toThrow(UrlRejected);
    }
    expect(assertFetchableUrl("https://example.com/path?q=1").hostname).toBe("example.com");
  });

  it("normalises URLs for deduplication", () => {
    expect(normalizeUrl("https://Example.com/a/?utm_source=x&id=2#top")).toBe("https://example.com/a/?id=2");
    expect(normalizeUrl("https://example.com/")).toBe("https://example.com");
  });
});

describe("safe fetcher", () => {
  let server: http.Server;
  let port: number;
  const loopback = (_host: string, o: { all?: boolean }, cb: (e: Error | null, a: unknown, f?: number) => void) =>
    o.all ? cb(null, [{ address: "127.0.0.1", family: 4 }]) : cb(null, "127.0.0.1", 4);

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const send = (status: number, type: string, body: string | Buffer, extra: Record<string, string> = {}) => {
        res.writeHead(status, { "content-type": type, ...extra });
        res.end(body);
      };
      switch (req.url) {
        case "/ok": return send(200, "text/html; charset=utf-8", "<html><title>Hi</title><body><p>Hello world, this is a page.</p></body></html>");
        case "/pdf": return send(200, "application/pdf", "%PDF");
        case "/big": return send(200, "text/html", Buffer.alloc(2_000_000, "a"));
        case "/redir": return send(302, "text/plain", "", { location: "/ok" });
        case "/loop": return send(302, "text/plain", "", { location: "/loop" });
        case "/to-private": return send(302, "text/plain", "", { location: `http://127.0.0.1:${port}/ok` });
        default: return send(404, "text/plain", "nope");
      }
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(() => void server.close());

  const fetcher = () => createSafeFetcher({ lookup: loopback as never });
  const url = (p: string) => `http://test.example:${port}${p}`;

  it("fetches a page and follows a redirect", async () => {
    expect((await fetcher().fetch(url("/ok"))).html).toContain("Hello world");
    expect((await fetcher().fetch(url("/redir"))).url).toBe(url("/ok"));
  });

  it("refuses binary types, oversized pages, errors, loops, and redirects to private addresses", async () => {
    const f = fetcher();
    await expect(f.fetch(url("/pdf"))).rejects.toMatchObject({ code: "unsupported" });
    await expect(f.fetch(url("/big"))).rejects.toMatchObject({ code: "too_large" });
    await expect(f.fetch(url("/missing"))).rejects.toMatchObject({ code: "http" });
    await expect(f.fetch(url("/loop"))).rejects.toMatchObject({ code: "rejected" });
    await expect(f.fetch(url("/to-private"))).rejects.toMatchObject({ code: "rejected" });
    await expect(f.fetch("http://127.0.0.1:" + port + "/ok")).rejects.toThrow(UrlRejected);
  });

  it("the default guard blocks a hostname that resolves to a private address, at connect time", async () => {
    const resolvesPrivately = ((host: string, opts: unknown, cb: (e: null, a: Array<{ address: string; family: number }>) => void) => cb(null, [{ address: "127.0.0.1", family: 4 }])) as never;
    const f = createSafeFetcher({ lookup: makeGuardedLookup(resolvesPrivately) });
    const err = await f.fetch(url("/ok")).catch((e) => e);
    expect(err).toBeInstanceOf(FetchError);
    expect(err.code).toBe("rejected");
  });

  it("blocks when any resolved address is private (DNS answers mixing public and private)", async () => {
    const mixed = ((host: string, opts: unknown, cb: (e: null, a: Array<{ address: string; family: number }>) => void) => cb(null, [{ address: "93.184.216.34", family: 4 }, { address: "10.0.0.1", family: 4 }])) as never;
    const f = createSafeFetcher({ lookup: makeGuardedLookup(mixed) });
    await expect(f.fetch(url("/ok"))).rejects.toMatchObject({ code: "rejected" });
  });
});

describe("text extraction", () => {
  it("keeps the main content and drops navigation, scripts and footers", () => {
    const { title, text } = extractText(
      `<html><head><title> A  Title </title><script>var x=1</script></head><body><nav>Menu Pricing</nav><main><h1>Heading</h1><p>First paragraph here.</p><ul><li>Item one</li></ul><table><tr><td>Cell A</td></tr></table></main><footer>Copyright</footer></body></html>`,
    );
    expect(title).toBe("A Title");
    expect(text).toBe("Heading\nFirst paragraph here.\nItem one\nCell A");
  });

  it("falls back to the body when there is no main or article", () => {
    expect(extractText("<body><div><p>Just a paragraph of text.</p></div></body>").text).toBe("Just a paragraph of text.");
  });

  it("selects the paragraphs relevant to the question, in document order", () => {
    const text = ["Intro line about nothing", ...Array.from({ length: 30 }, (_, i) => `Filler paragraph ${i} lorem ipsum dolor sit amet consectetur`), "The Pro plan costs $8 per month", "More filler text goes here to pad it out nicely"].join("\n");
    const out = selectRelevant(text, "Pro plan price per month", 300);
    expect(out.length).toBeLessThanOrEqual(300);
    expect(out).toContain("The Pro plan costs $8 per month");
    expect(selectRelevant("short", "q", 300)).toBe("short");
  });
});

describe("quote checking", () => {
  const page = "Acme’s Pro plan costs $8 per user per month — billed annually. Campus licences are priced on request.";

  it("matches ignoring case, quote marks, dashes and whitespace", () => {
    expect(quoteInText("acme's pro plan costs $8 per user per month - billed annually", page)).toBe(true);
    expect(quoteInText("Campus   licences are\npriced on request", page)).toBe(true);
    expect(normalizeForMatch("“Hi”  there")).toBe('"hi" there');
  });

  it("rejects invented, altered and trivially short quotes", () => {
    expect(quoteInText("The Pro plan costs $10 per user per month", page)).toBe(false);
    expect(quoteInText("billed annually", page)).toBe(false); // under the minimum length
    expect(quoteInText("", page)).toBe(false);
  });

  it("requires every number in a claim to appear in its quote", () => {
    expect(numbersSupported("The Pro plan costs $8 per user per month", "Pro plan costs $8 per user per month")).toBe(true);
    expect(numbersSupported("Pro plan costs $12 per month", "Pro plan costs $8 per month")).toBe(false);
    expect(numbersSupported("Over 10,000 students use it", "used by 10000 students")).toBe(true);
    expect(numbersSupported("The market is growing fast", "no numbers here")).toBe(true);
  });
});

describe("synthesis verification", () => {
  const pages: PageForSynthesis[] = [
    { label: "S1", sourceId: "s1", url: "https://a.example/p", title: "A", publisher: "a.example", text: "The Pro plan costs $8 per user per month billed annually.\nCampus licences are priced on request.", excerpt: "" },
    { label: "S2", sourceId: "s2", url: "https://b.example/p", title: "B", publisher: "b.example", text: "According to the vendor the Pro plan costs $8 per user per month when billed annually.", excerpt: "" },
  ];
  const run = (structuredResult: unknown) => synthesize(new FakeProvider({ structuredResult }), { question: "q", focus: "pricing", pages });
  const finding = (over: Record<string, unknown> = {}) => ({
    claim: "The Pro plan costs $8 per user per month",
    implication: "Cheaper than we assumed",
    confidence: "high",
    support: [{ source: "S1", quote: "The Pro plan costs $8 per user per month billed annually." }],
    ...over,
  });
  const wrap = (findings: unknown[], competitors: unknown[] = []) => ({ findings, competitors, gaps: [] });

  it("keeps a finding whose quote is on the page", async () => {
    const r = await run(wrap([finding()]));
    expect(r.findings).toHaveLength(1);
    expect(r.dropped).toBe(0);
  });

  it("drops a fabricated quote, a quote attributed to the wrong page, and an unknown source", async () => {
    const r = await run(
      wrap([
        finding({ support: [{ source: "S1", quote: "The Pro plan costs $12 per user per month billed annually." }] }),
        finding({ support: [{ source: "S2", quote: "Campus licences are priced on request." }] }),
        finding({ support: [{ source: "S9", quote: "The Pro plan costs $8 per user per month billed annually." }] }),
      ]),
    );
    expect(r.findings).toEqual([]);
    expect(r.dropped).toBe(3);
  });

  it("drops a claim whose number is not in the quote, even if the quote is real", async () => {
    const r = await run(wrap([finding({ claim: "The Pro plan costs $12 per user per month" })]));
    expect(r.findings).toEqual([]);
  });

  it("caps confidence: one publisher is at most medium, two independent publishers can be high", async () => {
    const one = await run(wrap([finding()]));
    expect(one.findings[0].confidence).toBe("medium");
    const two = await run(wrap([finding({ support: [{ source: "S1", quote: "The Pro plan costs $8 per user per month billed annually." }, { source: "S2", quote: "the Pro plan costs $8 per user per month when billed annually" }] })]));
    expect(two.findings[0].confidence).toBe("high");
    expect(two.findings[0].support).toHaveLength(2);
    const low = await run(wrap([finding({ confidence: "low" })]));
    expect(low.findings[0].confidence).toBe("low");
  });

  it("keeps verified competitor fields, drops unverified ones, and drops competitors left with none", async () => {
    const r = await run(
      wrap(
        [],
        [
          { company: "Acme", fields: [
            { field: "pricing", value: "$8 per user per month", source: "S1", quote: "The Pro plan costs $8 per user per month billed annually." },
            { field: "weaknesses", value: "slow mobile app", source: "S1", quote: "The mobile app is slow and unreliable." },
          ] },
          { company: "Ghost", fields: [{ field: "pricing", value: "$1", source: "S1", quote: "Ghost costs $1 a month for everyone." }] },
        ],
      ),
    );
    expect(r.competitors).toHaveLength(1);
    expect(r.competitors[0].fields.map((f) => f.field)).toEqual(["pricing"]);
    expect(r.dropped).toBe(2);
  });
});

describe("runResearch", () => {
  let db: Db;
  beforeEach(() => {
    db = createDb(":memory:");
  });

  const synthOut = {
    findings: [
      {
        claim: "Acme Scheduler's Pro plan costs $8 per user per month billed annually",
        implication: "A $5/month price would undercut Acme.",
        confidence: "high",
        support: [
          { source: "S1", quote: "the Pro plan costs $8 per user per month billed annually" },
          { source: "S2", quote: "The Pro plan costs $8 per user per month when billed annually" },
        ],
      },
      { claim: "Acme Scheduler has 2 million users", implication: "", confidence: "high", support: [{ source: "S1", quote: "Acme Scheduler has two million active users worldwide" }] },
    ],
    competitors: [{ company: "Acme Scheduler", fields: [{ field: "pricing", value: "Free Starter; Pro $8 per user per month annually", source: "S1", quote: "The Starter plan is free for up to 3 groups, and the Pro plan costs $8 per user per month billed annually." }] }],
    gaps: ["Market size"],
  };
  const deps = (over: Partial<Parameters<typeof runResearch>[0]> = {}) => ({
    db,
    provider: new FakeProvider({ structuredResult: synthOut }),
    search: new FakeSearch(),
    fetcher: new FakeFetcher(),
    ...over,
  });
  const args = { question: "What does Acme Scheduler charge?", queries: ["acme scheduler pricing"], focus: "pricing" };

  it("stores verified findings with sources, competitors with per-field sources, and reports handles", async () => {
    const statuses: string[] = [];
    const out = await runResearch(deps(), args, (s) => statuses.push(s));
    expect(out.ok).toBe(true);
    expect(out.stats).toMatchObject({ read: 3, findings: 1, dropped: 1 });
    expect(statuses[0]).toBe("Searching: acme scheduler pricing");
    expect(statuses).toContain("Checking sources…");

    const [item] = listItems(db, { kind: "research" });
    expect(item).toMatchObject({ origin: "research", createdBy: "agent", status: "active", confidence: "high" });
    expect(JSON.parse(item.data)).toMatchObject({ question: args.question, implication: "A $5/month price would undercut Acme." });
    const links = listSourcesForItem(db, item.id);
    expect(links.map((l) => l.publisher).sort()).toEqual(["acme-scheduler.example", "reviews.example"]);
    expect(links[0].quote.length).toBeGreaterThan(15);
    expect(links[0].fetchedAt).toMatch(/^\d{4}-/);

    const [comp] = listCompetitorRows(db);
    expect(comp.company).toBe("Acme Scheduler");
    expect(comp.pricing).toContain("$8");
    expect(parseFieldSources(comp).pricing?.[0].quote).toContain("Starter plan is free");

    expect(out.text).toContain(`[m:${Object.keys(out.refs)[0]}]`);
    expect(out.text).toContain("1 claim were discarded");
    expect(out.text).toContain("Market size");
    expect(out.refs[Object.keys(out.refs)[0]]).toMatchObject({ id: item.id, kind: "research" });
  });

  it("does not duplicate a finding on re-research, and reuses recently fetched pages", async () => {
    const fetcher = new FakeFetcher();
    await runResearch(deps({ fetcher }), args);
    const fetchedOnce = fetcher.fetched.length;
    await runResearch(deps({ fetcher }), args);
    expect(listItems(db, { kind: "research" })).toHaveLength(1);
    expect(fetcher.fetched.length).toBe(fetchedOnce); // served from stored sources
    expect(listCompetitorRows(db)).toHaveLength(1);
    expect(findFreshSource(db, "https://studyhub.example/about", "2000-01-01")).toBeDefined();
  });

  it("limits queries, merges and dedupes results, and skips non-pages", async () => {
    const search = new FakeSearch((q) => [{ title: "dup", url: "https://acme-scheduler.example/pricing?utm_source=x" }, { title: "pdf", url: "https://x.example/file.pdf" }, { title: q, url: `https://studyhub.example/about#${q}` }]);
    const fetcher = new FakeFetcher();
    await runResearch(deps({ search, fetcher }), { ...args, queries: ["a", "b", "c", "d", "a"] });
    expect(search.queries).toEqual(["a", "b", "c"]);
    expect(fetcher.fetched.sort()).toEqual(["https://acme-scheduler.example/pricing", "https://studyhub.example/about"]);
  });

  it("fails clearly, and stores nothing, when search is unavailable or unconfigured", async () => {
    const down = await runResearch(deps({ search: new FakeSearch(new SearchError("unavailable")) }), args);
    expect(down.ok).toBe(false);
    expect(down.text).toContain("unavailable");
    expect(down.text).toContain("Do not present anything you say next as researched");
    const noKey = await runResearch(deps({ search: new FakeSearch(new SearchError("missing_key")) }), args);
    expect(noKey.text).toContain("isn't set up");
    expect(listItems(db)).toEqual([]);
  });

  it("fails clearly when no page can be read or the synthesis breaks", async () => {
    const unreadable = await runResearch(deps({ fetcher: new FakeFetcher({}) }), args);
    expect(unreadable).toMatchObject({ ok: false });
    expect(unreadable.text).toContain("None of the pages could be read");
    const broken = await runResearch(deps({ provider: new FakeProvider({ failWith: new Error("x") }) }), args);
    expect(broken.ok).toBe(false);
    expect(listItems(db)).toEqual([]);
  });

  it("an empty verified result is reported honestly, not as research", async () => {
    const out = await runResearch(deps({ provider: new FakeProvider({ structuredResult: { findings: [], competitors: [], gaps: ["Everything"] } }) }), args);
    expect(out.ok).toBe(true);
    expect(out.text).toContain("No claim could be verified");
    expect(listItems(db, { kind: "research" })).toEqual([]);
  });

  it("page text is stored, so quotes stay verifiable later", async () => {
    await runResearch(deps(), args);
    const [item] = listItems(db, { kind: "research" });
    const [link] = listSourcesForItem(db, item.id);
    expect(getItem(db, item.id)).toBeDefined();
    expect(normalizeForMatch(FIXTURE_PAGES[link.url])).toBeTruthy();
  });
});

describe("Brave search backend", () => {
  const withKey = (fn: () => Promise<void>) => async () => {
    process.env.BRAVE_API_KEY = "test";
    try {
      await fn();
    } finally {
      delete process.env.BRAVE_API_KEY;
    }
  };
  const respond = (status: number, body: unknown) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

  it("parses results", withKey(async () => {
    const r = await new BraveSearch(respond(200, { web: { results: [{ title: "T", url: "https://a.example", age: "2 days ago" }, { title: "no url" }] } })).search("q");
    expect(r).toEqual([{ title: "T", url: "https://a.example", age: "2 days ago" }]);
  }));

  it("maps failures to search errors", withKey(async () => {
    await expect(new BraveSearch(respond(429, {})).search("q")).rejects.toMatchObject({ code: "rate_limited" });
    await expect(new BraveSearch(respond(401, {})).search("q")).rejects.toMatchObject({ code: "missing_key" });
    await expect(new BraveSearch(respond(500, {})).search("q")).rejects.toMatchObject({ code: "unavailable" });
  }));

  it("reports a missing key", async () => {
    delete process.env.BRAVE_API_KEY;
    await expect(new BraveSearch().search("q")).rejects.toMatchObject({ code: "missing_key" });
  });
});

describe("research output handed to the chat model", () => {
  it("frames findings as untrusted data and bars unresearched claims from being presented as researched", async () => {
    const db = createDb(":memory:");
    const out = await runResearch(
      { db, provider: new FakeProvider({ structuredResult: { findings: [{ claim: "Acme Scheduler's Pro plan costs $8 per user per month billed annually", implication: "", confidence: "high", support: [{ source: "S1", quote: "the Pro plan costs $8 per user per month billed annually" }] }], competitors: [], gaps: [] } }), search: new FakeSearch(), fetcher: new FakeFetcher() },
      { question: "What does Acme charge?", queries: ["acme pricing"] },
    );
    expect(out.text).toContain("untrusted web pages");
    expect(out.text).toContain("labelled as unchecked");
  });
});
