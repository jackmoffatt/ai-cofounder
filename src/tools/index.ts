import type { Intent } from "@/agent/intent";
import { searchMemory } from "./searchMemory";
import { ToolRegistry } from "./registry";
import { webResearch } from "./webResearch";

export { ToolRegistry } from "./registry";
export type { Tool, ToolContext, ToolResult } from "./types";

/** The app's tools. Add new ones here; external-risk tools are gated by the registry automatically. */
export function createDefaultRegistry(): ToolRegistry {
  return new ToolRegistry().register(webResearch).register(searchMemory);
}

/**
 * Which tools this message gets. Offering fewer keeps replies fast and focused: research only when
 * outside facts are needed, memory search when the founder is recalling.
 */
export function toolNamesFor(intent: Pick<Intent, "needsResearch" | "recall">): string[] {
  return [...(intent.needsResearch ? ["web_research"] : []), ...(intent.needsResearch || intent.recall ? ["search_memory"] : [])];
}
