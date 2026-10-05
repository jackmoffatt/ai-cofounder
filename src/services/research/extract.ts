import * as cheerio from "cheerio";

export const MAX_STORED_CHARS = 60_000;

export interface Extracted {
  title: string;
  text: string;
}

const NOISE = "script,style,noscript,svg,iframe,canvas,nav,header,footer,aside,form,button,select,[role=navigation],[aria-hidden=true],.cookie,.cookies,#cookie-banner";

/** Readable text from an HTML page: title plus the main content, one block per line. */
export function extractText(html: string): Extracted {
  const $ = cheerio.load(html);
  const title = ($("meta[property='og:title']").attr("content") || $("title").first().text() || $("h1").first().text()).replace(/\s+/g, " ").trim();
  $(NOISE).remove();
  const root = $("main").first().length ? $("main").first() : $("article").first().length ? $("article").first() : $("[role=main]").first().length ? $("[role=main]").first() : $("body");
  const blocks: string[] = [];
  root.find("h1,h2,h3,h4,h5,h6,p,li,td,th,blockquote,pre,dd,dt,figcaption").each((_, el) => {
    // Skip containers whose text is already covered by a nested block.
    if ($(el).find("p,li,td,blockquote,pre").length) return;
    const t = $(el).text().replace(/\s+/g, " ").trim();
    if (t.length > 1) blocks.push(t);
  });
  const text = (blocks.length ? blocks.join("\n") : root.text().replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim()).slice(0, MAX_STORED_CHARS);
  return { title, text };
}

/**
 * Picks the paragraphs most relevant to the question, in document order, up to `maxChars`. Whole
 * pages are too long to show a model; relevance beats truncation from the top.
 */
export function selectRelevant(text: string, query: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const terms = [...new Set(query.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 2))];
  const paragraphs = text.split("\n").map((p, i) => ({ p, i, score: terms.reduce((n, t) => n + (p.toLowerCase().includes(t) ? 1 : 0), 0) + (i < 3 ? 0.5 : 0) }));
  const chosen = new Set<number>();
  let used = 0;
  for (const para of [...paragraphs].sort((a, b) => b.score - a.score || a.i - b.i)) {
    if (used + para.p.length + 1 > maxChars) continue;
    chosen.add(para.i);
    used += para.p.length + 1;
  }
  return paragraphs.filter((x) => chosen.has(x.i)).map((x) => x.p).join("\n");
}
