import type { Db } from "@/db/client";
import { insertTrace } from "@/db/queries/context";
import type { ToolCallRecord } from "@/tools/types";
import type { ContextTrace } from "./contextBuilder";

export interface TraceInput {
  id: string;
  conversationId: string;
  messageId: string | null;
  context: ContextTrace;
  memoryEventIds: string[];
  proposalIds: string[];
  tools: ToolCallRecord[];
  model: string;
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
}

/** Records what the agent saw and did this turn. Never throws: observability must not break chat. */
export function writeTrace(db: Db, t: TraceInput): void {
  try {
    insertTrace(db, {
      id: t.id,
      conversationId: t.conversationId,
      messageId: t.messageId,
      mode: t.context.intent.mode,
      context: JSON.stringify(t.context),
      outputs: JSON.stringify({ memoryEventIds: t.memoryEventIds, proposalIds: t.proposalIds, tools: t.tools }),
      model: t.model,
      tokensIn: t.tokensIn,
      tokensOut: t.tokensOut,
      latencyMs: t.latencyMs,
      createdAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error("trace write failed:", err instanceof Error ? err.name : "unknown");
  }
}
