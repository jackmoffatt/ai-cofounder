import Anthropic from "@anthropic-ai/sdk";
import { modelFor } from "@/services/ai/models";

export interface SearchResult {
  title: string;
  url: string;
  /** Page age as reported by the search engine, if any. */
  age?: string | null;
}

export class SearchError extends Error {
  constructor(
    readonly code: "missing_key" | "rate_limited" | "unavailable" | "unknown",
    message?: string,
  ) {
    super(message ?? code);
  }
}

/** The one thing research needs from a search engine: URLs worth reading. Page text comes from our own fetcher. */
export interface SearchBackend {
  readonly name: string;
  search(query: string, opts?: { limit?: number; signal?: AbortSignal }): Promise<SearchResult[]>;
}

/**
 * Anthropic's hosted web search: needs no key beyond the one already configured. It returns result
 * URLs and titles (page text is encrypted for the model), so we read the pages ourselves.
 */
export class AnthropicSearch implements SearchBackend {
  readonly name = "anthropic";
  private client: Anthropic | null = null;

  async search(query: string, opts: { limit?: number; signal?: AbortSignal } = {}): Promise<SearchResult[]> {
    if (!process.env.ANTHROPIC_API_KEY) throw new SearchError("missing_key", "No API key is configured.");
    this.client ??= new Anthropic();
    try {
      const res = await this.client.messages.create(
        {
          model: modelFor("search"),
          max_tokens: 1024,
          tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 1 }],
          messages: [{ role: "user", content: `Search the web for: ${query}` }],
        },
        { signal: opts.signal },
      );
      const results: SearchResult[] = [];
      for (const block of res.content) {
        if (block.type !== "web_search_tool_result") continue;
        if (!Array.isArray(block.content)) {
          const code = (block.content as { error_code?: string }).error_code;
          throw new SearchError(code === "too_many_requests" ? "rate_limited" : "unavailable", code);
        }
        for (const r of block.content) if (r.type === "web_search_result") results.push({ title: r.title, url: r.url, age: r.page_age });
      }
      return results.slice(0, opts.limit ?? 8);
    } catch (err) {
      if (err instanceof SearchError) throw err;
      if (err instanceof Anthropic.RateLimitError) throw new SearchError("rate_limited");
      if (err instanceof Anthropic.APIConnectionError || (err instanceof Anthropic.APIError && (err.status ?? 0) >= 500)) throw new SearchError("unavailable");
      throw new SearchError("unknown");
    }
  }
}

/** Brave Search API (BRAVE_API_KEY). A plain REST alternative if you'd rather not use hosted search. */
export class BraveSearch implements SearchBackend {
  readonly name = "brave";

  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  async search(query: string, opts: { limit?: number; signal?: AbortSignal } = {}): Promise<SearchResult[]> {
    const key = process.env.BRAVE_API_KEY;
    if (!key) throw new SearchError("missing_key", "No Brave API key is configured.");
    let res: Response;
    try {
      res = await this.fetchImpl(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${opts.limit ?? 8}`, {
        headers: { Accept: "application/json", "X-Subscription-Token": key },
        signal: opts.signal,
      });
    } catch {
      throw new SearchError("unavailable");
    }
    if (res.status === 429) throw new SearchError("rate_limited");
    if (res.status === 401 || res.status === 403) throw new SearchError("missing_key", "The search API key was rejected.");
    if (!res.ok) throw new SearchError("unavailable");
    const json = (await res.json().catch(() => null)) as { web?: { results?: Array<{ title?: string; url?: string; age?: string }> } } | null;
    return (json?.web?.results ?? []).flatMap((r) => (r.url && r.title ? [{ title: r.title, url: r.url, age: r.age ?? null }] : [])).slice(0, opts.limit ?? 8);
  }
}

let backend: SearchBackend | undefined;

/** Chooses the search backend from SEARCH_BACKEND ("anthropic" default, "brave"). */
export function getSearchBackend(): SearchBackend {
  if (!backend) {
    switch (process.env.SEARCH_BACKEND ?? "anthropic") {
      case "brave":
        backend = new BraveSearch();
        break;
      case "anthropic":
        backend = new AnthropicSearch();
        break;
      default:
        throw new Error(`Unknown SEARCH_BACKEND "${process.env.SEARCH_BACKEND}"`);
    }
  }
  return backend;
}
