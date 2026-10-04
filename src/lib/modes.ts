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
