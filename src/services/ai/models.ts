/**
 * Maps what the app needs ("chat", "title", ...) to a concrete model. Precedence: a setting saved in
 * the app, then an AI_MODEL_<ROLE> environment variable, then the default.
 */
export const MODEL_ROLES = ["chat", "title", "extract", "classify", "summarize", "brief", "plan", "research", "search"] as const;
export type ModelRole = (typeof MODEL_ROLES)[number];

export const DEFAULTS: Record<ModelRole, string> = {
  chat: "claude-opus-5-5",
  title: "claude-haiku-4-5",
  extract: "claude-haiku-4-5",
  classify: "claude-haiku-4-5",
  summarize: "claude-haiku-4-5",
  brief: "claude-sonnet-5-5",
  plan: "claude-sonnet-5-5",
  research: "claude-sonnet-5-5",
  search: "claude-haiku-4-5",
};

export const ROLE_INFO: Record<ModelRole, { label: string; description: string }> = {
  chat: { label: "Conversation", description: "Your replies. The most capable model you want to talk to." },
  title: { label: "Titles", description: "Names new conversations. Cheap and fast is fine." },
  extract: { label: "Memory extraction", description: "Reads each message for facts, assumptions, tasks and changes." },
  classify: { label: "Routing", description: "Decides what kind of help each message needs." },
  summarize: { label: "Summaries", description: "Condenses long conversations." },
  brief: { label: "Startup brief", description: "Writes the brief and the recommended next action." },
  plan: { label: "Plans", description: "Turns a plan into an objective, experiments and tasks." },
  research: { label: "Research findings", description: "Extracts findings, with quotes, from web pages." },
  search: { label: "Web search", description: "Runs hosted web search (Anthropic search backend only)." },
};

/**
 * Held on globalThis, not in a module variable: Next bundles pages and API routes separately, so each
 * would get its own copy of a module-level value and a setting saved by one would be invisible to the other.
 */
const holder = globalThis as unknown as { __modelOverrides?: Partial<Record<ModelRole, string>> };
const overrides = () => (holder.__modelOverrides ??= {});

/** Replaces the saved overrides (called when the database opens and when a setting changes). */
export function setModelOverrides(next: Partial<Record<ModelRole, string>>): void {
  holder.__modelOverrides = { ...next };
}

export function modelFor(role: ModelRole): string {
  return overrides()[role] || process.env[`AI_MODEL_${role.toUpperCase()}`] || DEFAULTS[role];
}

export function modelSource(role: ModelRole): "setting" | "environment" | "default" {
  return overrides()[role] ? "setting" : process.env[`AI_MODEL_${role.toUpperCase()}`] ? "environment" : "default";
}

/** Shape check only: whether the model exists is the provider's call, and "Test connection" finds out. */
export const isValidModelId = (id: string): boolean => /^[a-z0-9][a-z0-9._:-]{2,80}$/i.test(id);
