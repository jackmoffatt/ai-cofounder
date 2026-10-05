import type { FetchedPage, PageFetcher } from "./fetcher";
import type { SearchBackend, SearchResult } from "./search";

/** Offline stand-ins for tests and `RESEARCH_FAKE=1` development: no network, fixed pages. */
export class FakeSearch implements SearchBackend {
  readonly name = "fake";
  readonly queries: string[] = [];

  constructor(private readonly results: SearchResult[] | ((q: string) => SearchResult[]) | Error = FIXTURE_RESULTS) {}

  async search(query: string): Promise<SearchResult[]> {
    this.queries.push(query);
    if (this.results instanceof Error) throw this.results;
    return typeof this.results === "function" ? this.results(query) : this.results;
  }
}

export class FakeFetcher implements PageFetcher {
  readonly fetched: string[] = [];

  constructor(private readonly pages: Record<string, string> = FIXTURE_PAGES) {}

  async fetch(url: string): Promise<FetchedPage> {
    this.fetched.push(url);
    const html = this.pages[url];
    if (html === undefined) throw new Error("not found");
    return { url, status: 200, contentType: "text/html", html };
  }
}

const page = (title: string, body: string) =>
  `<html><head><title>${title}</title></head><body><nav>Home Pricing About</nav><main>${body}</main><footer>© 2026</footer></body></html>`;

export const FIXTURE_PAGES: Record<string, string> = {
  "https://acme-scheduler.example/pricing": page(
    "Acme Scheduler Pricing",
    `<h1>Pricing</h1><p>Acme Scheduler is built for university students who organise group projects and study sessions.</p>
     <p>The Starter plan is free for up to 3 groups, and the Pro plan costs $8 per user per month billed annually.</p>
     <p>Campus licences for universities are priced on request and include single sign-on.</p>`,
  ),
  "https://reviews.example/acme-scheduler": page(
    "Acme Scheduler review",
    `<h1>Acme Scheduler review</h1><p>Reviewers say the calendar sync is the best feature, but the mobile app is slow and notifications are unreliable.</p>
     <p>The Pro plan costs $8 per user per month when billed annually, according to the vendor's pricing page.</p>`,
  ),
  "https://studyhub.example/about": page(
    "StudyHub",
    `<h1>StudyHub</h1><p>StudyHub helps students find study partners on campus. The app is free and earns revenue from sponsored listings by tutoring companies.</p>
     <p>Students create a profile with their courses and availability, and StudyHub suggests partners who share classes and free time. Tutoring companies pay to appear in the results for specific courses.</p>`,
  ),
};

export const FIXTURE_RESULTS: SearchResult[] = Object.keys(FIXTURE_PAGES).map((url) => ({ title: url, url }));
