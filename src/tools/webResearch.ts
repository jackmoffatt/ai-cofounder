import { z } from "zod";
import { runResearch } from "@/services/research";
import { FakeFetcher, FakeSearch } from "@/services/research/fake";
import { createSafeFetcher, type PageFetcher } from "@/services/research/fetcher";
import { getSearchBackend } from "@/services/research/search";
import type { Tool, ToolContext } from "./types";

const Args = z.object({
  question: z.string().min(5).max(500).describe("The specific question to answer, in a sentence."),
  queries: z.array(z.string().min(2).max(200)).min(1).max(3).describe("1 to 3 distinct web search queries that would find pages answering the question."),
  focus: z.enum(["competitors", "pricing", "market", "customers", "technology", "general"]).optional().describe("What kind of facts matter most."),
});

let fetcher: PageFetcher | undefined;

/** Real or fake research dependencies, chosen once from the environment. */
export function researchDeps(ctx: ToolContext) {
  if (ctx.research) return ctx.research;
  if (process.env.RESEARCH_FAKE === "1") return { search: new FakeSearch(), fetcher: new FakeFetcher() };
  return { search: getSearchBackend(), fetcher: (fetcher ??= createSafeFetcher()) };
}

/**
 * Searches the web, reads the pages, and records only findings whose quotes are verified on those
 * pages. Use it for facts about the outside world that aren't already recorded.
 */
export const webResearch: Tool<z.infer<typeof Args>> = {
  name: "web_research",
  description:
    "Research a question on the web. Searches, reads the pages, and records findings that are verified against the page text, each with its sources. Use it when the answer depends on current facts about the outside world (competitors, pricing, market size, trends, how a product works) that are not already in the recorded knowledge. Don't use it for opinions, advice or the founder's own situation. After it returns, answer using only the verified findings, cite them with their [m:handle], and say clearly if research failed or found nothing.",
  input: Args,
  risk: "read",
  label: (a) => `Researching: ${a.question.length > 70 ? `${a.question.slice(0, 67)}…` : a.question}`,
  async execute(args, ctx) {
    const { search, fetcher: f } = researchDeps(ctx);
    const out = await runResearch({ db: ctx.db, provider: ctx.provider, search, fetcher: f }, args, ctx.report, ctx.signal);
    return { ok: out.ok, content: out.text, refs: out.refs };
  },
};
