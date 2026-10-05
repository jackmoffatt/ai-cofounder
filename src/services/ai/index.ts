import "server-only";
import { AnthropicProvider } from "./anthropic";
import { FakeProvider } from "./fake";
import { textOf, type AIProvider, type ChatRequest } from "./types";

export * from "./types";
export { modelFor, type ModelRole } from "./models";

/**
 * Dev-only stand-in for the extraction model (AI_PROVIDER=fake). Understands a few phrasings:
 *  "my name is X", "I only have N hours a week", "I think <claim>", "evidence: <obs>" (supports i1),
 *  "we should target <X>", "we are now in validation", "we decided to <X>".
 */
function fakeExtraction(req: ChatRequest) {
  const text = /<message>\n([\s\S]*)\n<\/message>/.exec(textOf(req.messages[0]?.content ?? ""))?.[1] ?? "";
  const out = {
    founder: [] as Array<{ field: string; value: string; quote: string }>,
    items: [] as Array<{ kind: string; title: string; details: string; importance: number; quote: string }>,
    evidence: [] as Array<{ target: string; stance: string; strength: string; excerpt: string; quote: string }>,
    tasks: [] as Array<{ title: string; dueDate: string | null; quote: string }>,
    taskUpdates: [] as Array<{ target: string; status: string; quote: string }>,
    proposals: [] as Array<{ type: string; field: string | null; value: string | null; target: string | null; rationale: string; quote: string }>,
  };
  const name = /my name is (\w+)/i.exec(text);
  if (name) out.founder.push({ field: "name", value: name[1], quote: name[0] });
  const time = /I (?:only )?have (\d+ hours a week)/i.exec(text);
  if (time) out.founder.push({ field: "constraints", value: time[1], quote: time[0] });
  const think = /I think ([^.\n]+)/i.exec(text);
  if (think) out.items.push({ kind: "assumption", title: think[1], details: "", importance: 4, quote: think[0] });
  const ev = /evidence: ([^.\n]+)/i.exec(text);
  if (ev) out.evidence.push({ target: "i1", stance: "supports", strength: "anecdotal", excerpt: ev[1], quote: ev[0] });
  const target = /we should target ([^.\n]+)/i.exec(text);
  if (target) out.proposals.push({ type: "startup_field", field: "targetCustomer", value: target[1], target: null, rationale: "You said so", quote: target[0] });
  const stage = /we are now in (validation)/i.exec(text);
  if (stage) out.proposals.push({ type: "stage", field: null, value: "validation", target: null, rationale: "You said so", quote: stage[0] });
  const remind = /remind me to ([^.\n]+)/i.exec(text);
  if (remind) out.tasks.push({ title: remind[1], dueDate: null, quote: remind[0] });
  const finished = /I finished ([^.\n]+)/i.exec(text);
  if (finished) out.taskUpdates.push({ target: "t1", status: "done", quote: finished[0] });
  const decided = /we decided to ([^.\n]+)/i.exec(text);
  if (decided) out.items.push({ kind: "decision", title: decided[1], details: "Stated by founder", importance: 4, quote: decided[0] });
  return out;
}

/** Routes `structured()` calls in dev mode by what the system prompt says the task is. */
function fakeStructured(req: ChatRequest) {
  if (req.system.includes("You route one message")) {
    const text = textOf(req.messages[0]?.content ?? "");
    const recall = /where were we|what did we|why did we|what should i work on/i.test(text);
    const mode = recall ? "REVIEW" : /competitor|market/i.test(text) ? "RESEARCH" : /interview|validate|assumption/i.test(text) ? "VALIDATE" : "DISCOVER";
    const keywords = (text.match(/[a-z]{5,}/gi) ?? []).slice(0, 4).map((w) => w.toLowerCase());
    const wantsPlan = /validate|plan|experiment/i.test(text) && !recall;
    const needsResearch = /research|competitor|pricing|market/i.test(text) && !recall;
    return { mode, kinds: [], keywords, recall, wantsPlan, needsResearch };
  }
  if (req.system.includes("You write the Startup Brief")) {
    return {
      narrative: "## Company\nAn early-stage startup. The founder believes the problem is real; this is untested.\n\n## Where we are\nStill gathering evidence.",
      nextAction: { action: "Interview five target customers", why: "The riskiest assumption has no evidence yet." },
    };
  }
  if (req.system.includes("extract verifiable research findings")) {
    return {
      findings: [
        {
          claim: "Acme Scheduler's Pro plan costs $8 per user per month billed annually",
          implication: "A student-focused price under $8 would undercut Acme.",
          confidence: "high",
          support: [
            { source: "S1", quote: "the Pro plan costs $8 per user per month billed annually" },
            { source: "S2", quote: "The Pro plan costs $8 per user per month when billed annually" },
          ],
        },
        { claim: "Acme Scheduler has 2 million users", implication: "", confidence: "high", support: [{ source: "S1", quote: "Acme Scheduler has two million active users worldwide" }] },
      ],
      competitors: [
        {
          company: "Acme Scheduler",
          fields: [{ field: "pricing", value: "Free Starter plan; Pro $8 per user per month billed annually", source: "S1", quote: "The Starter plan is free for up to 3 groups, and the Pro plan costs $8 per user per month billed annually." }],
        },
      ],
      gaps: ["Market size"],
    };
  }
  if (req.system.includes("convert a validation plan")) {
    return {
      plan: {
        objective: { title: "Find out whether students really lose time to scheduling", description: "Talk to real students", successCriteria: "7 of 10 describe it unprompted" },
        assumptions: [{ target: "i1", title: "Students lose time to scheduling" }],
        experiments: [{ assumption: 0, hypothesis: "Most students find scheduling painful", method: "10 short interviews", successCriteria: "7 of 10 mention it" }],
        tasks: [
          { title: "Write interview script", description: "", category: "research", priority: "high", experiment: 0, dependsOn: [], dueInDays: 1 },
          { title: "Interview 10 students", description: "", category: "interview", priority: "high", experiment: 0, dependsOn: [0], dueInDays: 7 },
        ],
      },
    };
  }
  return fakeExtraction(req);
}

let provider: AIProvider | undefined;

/** The one place that chooses a provider. Add new providers here. */
export function getProvider(): AIProvider {
  if (!provider) {
    switch (process.env.AI_PROVIDER ?? "anthropic") {
      case "fake":
        provider = new FakeProvider({
          delayMs: 15,
          structuredResult: fakeStructured,
          completeResult: (r) => (r.system.includes("running summary") ? "Earlier the founder and co-founder discussed the idea." : textOf(r.messages[0]?.content ?? "").split(/\s+/).slice(0, 4).join(" ")),
        });
        break;
      case "anthropic":
        provider = new AnthropicProvider();
        break;
      default:
        throw new Error(`Unknown AI_PROVIDER "${process.env.AI_PROVIDER}"`);
    }
  }
  return provider;
}
