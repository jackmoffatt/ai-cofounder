/** Normalises text for comparing a quote with a page: case, quote marks, dashes, whitespace. */
export function normalizeForMatch(s: string): string {
  return s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[‘’‚′]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/[‐-―−]/g, "-")
    .replace(/[​-‍﻿]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export const MIN_QUOTE_CHARS = 20;

/** True only if `quote` really appears in `pageText` (ignoring formatting). Trivially short quotes don't count. */
export function quoteInText(quote: string, pageText: string): boolean {
  const q = normalizeForMatch(quote).replace(/^[.…\s]+|[.…\s]+$/g, "");
  return q.length >= MIN_QUOTE_CHARS && normalizeForMatch(pageText).includes(q);
}

/** Numbers as comparable digit strings: "$1,200" → "1200", "35%" → "35", "4.5" → "4.5". */
export function numbersIn(s: string): string[] {
  return (s.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map((n) => n.replace(/,/g, ""));
}

/**
 * Every number in a claim must appear in the quote that supports it. This is what stops a plausible
 * statistic from being attached to a real but unrelated sentence.
 */
export function numbersSupported(claim: string, quote: string): boolean {
  const inQuote = new Set(numbersIn(quote));
  return numbersIn(claim).every((n) => inQuote.has(n));
}
