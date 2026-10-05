export const ITEM_KINDS = ["assumption", "decision", "question", "idea", "insight", "note", "research"] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];

export const KIND_LABELS: Record<ItemKind, { singular: string; plural: string }> = {
  assumption: { singular: "Assumption", plural: "Assumptions" },
  decision: { singular: "Decision", plural: "Decisions" },
  question: { singular: "Question", plural: "Open questions" },
  idea: { singular: "Idea", plural: "Ideas" },
  insight: { singular: "Customer insight", plural: "Customer insights" },
  note: { singular: "Note", plural: "Notes" },
  research: { singular: "Research finding", plural: "Research" },
};

/** Allowed statuses per kind. The first entry is the default for new items. */
export const STATUSES: Record<ItemKind, readonly string[]> = {
  assumption: ["untested", "testing", "supported", "validated", "weakened", "rejected"],
  decision: ["active", "proposed", "superseded", "reversed"],
  question: ["open", "answered", "dropped"],
  idea: ["raw", "exploring", "promoted", "discarded"],
  insight: ["active", "archived"],
  note: ["active", "archived"],
  research: ["active", "archived"],
};

export const CONFIDENCES = ["low", "medium", "high"] as const;
export type Confidence = (typeof CONFIDENCES)[number];

export const isValidStatus = (kind: ItemKind, status: string) => STATUSES[kind].includes(status);

/** Statuses that count as "closed" for the purposes of what the agent should keep in mind. */
export const INACTIVE_STATUSES = new Set(["superseded", "reversed", "answered", "dropped", "promoted", "discarded", "archived", "rejected"]);

export const PROPOSAL_TYPES = ["startup_field", "stage", "objective", "assumption_status", "decision_supersede"] as const;
export type ProposalType = (typeof PROPOSAL_TYPES)[number];

/** Short stable handle used to cite a memory item in text, e.g. [m:ab12cd34]. */
export const refFor = (id: string) => id.replace(/-/g, "").slice(0, 8);
