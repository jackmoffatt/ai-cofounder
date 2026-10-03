/**
 * The fact-vs-assumption rules, as code. The model can suggest; these functions decide.
 * Evidence is what moves an assumption, never the model's say-so.
 */
export type Stance = "supports" | "weakens";
export type Strength = "anecdotal" | "moderate" | "strong";

export interface EvidenceLike {
  stance: Stance;
  strength: Strength;
}

const WEIGHT: Record<Strength, number> = { anecdotal: 1, moderate: 2, strong: 3 };

/** Total supporting weight needed before an assumption may even be proposed as validated. */
export const VALIDATE_THRESHOLD = 6;
/** Total weakening weight needed before an assumption may be proposed as rejected. */
export const REJECT_THRESHOLD = 3;

/** Statuses derived from evidence automatically. validated/rejected are always a human decision. */
const AUTO_STATUSES = new Set(["untested", "testing", "supported", "weakened"]);

export function weights(evidence: EvidenceLike[]): { supports: number; weakens: number } {
  let supports = 0;
  let weakens = 0;
  for (const e of evidence) {
    if (e.stance === "supports") supports += WEIGHT[e.strength];
    else weakens += WEIGHT[e.strength];
  }
  return { supports, weakens };
}

/**
 * Status and confidence an assumption should have given its evidence.
 * A human-set validated/rejected status is kept; everything else follows the evidence.
 * No evidence always means untested and low confidence.
 */
export function deriveAssumptionState(
  evidence: EvidenceLike[],
  currentStatus: string,
): { status: string; confidence: "low" | "medium" | "high" } {
  const { supports, weakens } = weights(evidence);
  const strongest = Math.max(supports, weakens);
  let confidence: "low" | "medium" | "high" = strongest < 3 ? "low" : strongest < 6 ? "medium" : "high";
  if (supports > 0 && weakens > 0 && confidence === "high") confidence = "medium"; // contested

  if (evidence.length === 0) return { status: AUTO_STATUSES.has(currentStatus) ? "untested" : currentStatus, confidence: "low" };
  if (!AUTO_STATUSES.has(currentStatus)) return { status: currentStatus, confidence };

  let status: string;
  if (weakens > supports) status = "weakened";
  else if (weakens > 0) status = "testing";
  else status = supports >= 3 ? "supported" : "testing";
  return { status, confidence };
}

/** Whether the evidence on file justifies even *proposing* this terminal status. */
export function evidenceJustifies(evidence: EvidenceLike[], to: "validated" | "rejected"): boolean {
  const { supports, weakens } = weights(evidence);
  if (to === "validated") return supports >= VALIDATE_THRESHOLD && supports > 2 * weakens;
  return weakens >= REJECT_THRESHOLD && weakens > supports;
}
