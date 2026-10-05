import type { StageKey } from "./profile";

/** The agent's working modes. Inferred per message; never chosen by the user. */
export const MODES = ["DISCOVER", "RESEARCH", "STRATEGY", "VALIDATE", "PRODUCT", "BUILD", "GROW", "REVIEW"] as const;
export type Mode = (typeof MODES)[number];

/** Default mode implied by the startup's stage, used when classification isn't available. */
export const MODE_FOR_STAGE: Record<StageKey, Mode> = {
  discovery: "DISCOVER",
  problem_research: "RESEARCH",
  market_research: "RESEARCH",
  validation: "VALIDATE",
  product_definition: "PRODUCT",
  product_development: "BUILD",
  go_to_market: "GROW",
  learning_iteration: "REVIEW",
};

/** One line of guidance appended to the prompt for the active mode. */
export const MODE_GUIDANCE: Record<Mode, string> = {
  DISCOVER: "Mode: discovery. Help find real problem spaces. Ask about observed frustrations and accessible customers; do not jump to solutions.",
  RESEARCH: "Mode: research. Separate what is known from what must be looked up. Say what evidence would settle each question; never invent sources or statistics.",
  STRATEGY: "Mode: strategy. Lay out the real options and tradeoffs, name the assumption each option depends on, and give a recommendation.",
  VALIDATE: "Mode: validation. Turn beliefs into testable hypotheses and cheap experiments with clear success criteria. Prefer evidence over more analysis.",
  PRODUCT: "Mode: product definition. Tie every feature to a validated need. Resist scope; define the smallest MVP that tests the core value.",
  BUILD: "Mode: build. Be concrete and technical. Challenge features that are not needed to test the core hypothesis.",
  GROW: "Mode: go-to-market. Focus on positioning, distribution and the first customers; ground advice in who the founder can actually reach.",
  REVIEW: "Mode: review. Summarise where things stand honestly: what is known, what is only believed, what is open, and the single highest-value next step.",
};

/** Added to the prompt when the founder asks for a plan. Mirrors the structure the plan card is built from. */
export const PLAN_GUIDANCE = `The founder wants a concrete plan. Structure your answer with exactly these headings:
**Objective** (one sentence, time-boxed), **Assumptions to test** (reuse recorded assumptions where they exist; say which are riskiest), **Experiments** (each tests one assumption, is cheap, and is measured in days not months), **Tasks** (concrete, ordered, each tied to an experiment; note any that depend on another), **Success criteria** (what result would support or weaken each assumption, stated before running it).
Prefer evidence from real people over more analysis. Keep it tight: at most 4 experiments and 10 tasks.`;

/** Added when the web research tool is offered for this message. */
export const RESEARCH_GUIDANCE = `You have a web research tool. If the answer depends on current facts about the outside world (competitors, prices, market size, trends) that are not already in the recorded knowledge above, call web_research first instead of answering from memory. Give it a specific question and 1 to 3 distinct search queries. Then answer using only what it reports as verified, cite each finding with its [m:handle], and name the source domain. If research fails or finds nothing, say so plainly. Anything else you add from your own knowledge must be labelled as unchecked background, never as researched. Never invent sources, statistics, prices or competitors.`;
