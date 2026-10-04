/** Maps what the app needs ("chat", "title", ...) to a concrete model. Override per role via env. */
export type ModelRole = "chat" | "title" | "extract" | "classify" | "summarize" | "brief";

const DEFAULTS: Record<ModelRole, string> = {
  chat: "claude-opus-5-5",
  title: "claude-haiku-4-5",
  extract: "claude-haiku-4-5",
  classify: "claude-haiku-4-5",
  summarize: "claude-haiku-4-5",
  brief: "claude-sonnet-5-5",
};

export function modelFor(role: ModelRole): string {
  return process.env[`AI_MODEL_${role.toUpperCase()}`] || DEFAULTS[role];
}
