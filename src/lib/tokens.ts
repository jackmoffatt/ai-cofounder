/** Rough token estimate (~4 characters per token). Good enough for budgeting; real usage is recorded from the API. */
export const estimateTokens = (text: string): number => Math.ceil(text.length / 4);

/** Truncates to roughly `maxTokens`, cutting at a line boundary where possible. */
export function truncateToTokens(text: string, maxTokens: number): string {
  if (estimateTokens(text) <= maxTokens) return text;
  const cut = text.slice(0, maxTokens * 4);
  const lastBreak = cut.lastIndexOf("\n");
  return `${(lastBreak > cut.length * 0.6 ? cut.slice(0, lastBreak) : cut).trimEnd()}\n…`;
}
