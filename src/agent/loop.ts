import type { AIProvider, ChatMessage, ContentPart, StopReason, Usage } from "@/services/ai/types";
import type { ToolRegistry } from "@/tools/registry";
import type { ToolCallRecord, ToolContext } from "@/tools/types";

export type LoopEvent =
  | { type: "text_delta"; text: string }
  | { type: "status"; text: string }
  | { type: "refs"; refs: Record<string, { id: string; kind: string; title: string }> }
  | { type: "done"; stopReason: StopReason; usage: Usage; model: string; tools: ToolCallRecord[] };

export interface LoopInput {
  provider: AIProvider;
  registry: ToolRegistry;
  /** Tools offered to the model this turn. */
  toolNames: string[];
  model: string;
  system: string;
  messages: ChatMessage[];
  maxTokens: number;
  effort?: "low" | "medium" | "high";
  signal?: AbortSignal;
  toolContext: Omit<ToolContext, "report" | "signal">;
  /** Model round trips allowed. The last one is made without tools, so the turn always ends in an answer. */
  maxSteps?: number;
}

/**
 * Runs the model, and whenever it asks for a tool, runs it and feeds the result back, until the model
 * answers. Streams text as it arrives and reports tool activity as short status lines.
 */
export async function* runModelLoop(input: LoopInput): AsyncGenerator<LoopEvent> {
  const { provider, registry, signal } = input;
  const maxSteps = input.maxSteps ?? 4;
  const messages = [...input.messages];
  const usage: Usage = { inputTokens: 0, outputTokens: 0 };
  const records: ToolCallRecord[] = [];
  let model = input.model;
  let stopReason: StopReason = "end_turn";
  let wroteText = false;

  for (let step = 0; step < maxSteps; step++) {
    const specs = step < maxSteps - 1 ? registry.specs(input.toolNames) : [];
    const calls: Array<{ id: string; name: string; input: unknown }> = [];
    let stepText = "";
    let native: unknown;

    for await (const ev of provider.stream({
      model: input.model,
      system: input.system,
      messages,
      maxTokens: input.maxTokens,
      effort: input.effort,
      tools: specs.length ? specs : undefined,
      signal,
    })) {
      if (ev.type === "text_delta") {
        // Keep text from separate steps apart ("Let me check." ... "Here's what I found.").
        const sep = !stepText && wroteText ? "\n\n" : "";
        stepText += ev.text;
        wroteText = true;
        yield { type: "text_delta", text: sep + ev.text };
      } else if (ev.type === "tool_call") {
        calls.push({ id: ev.id, name: ev.name, input: ev.input });
      } else {
        usage.inputTokens += ev.usage.inputTokens;
        usage.outputTokens += ev.usage.outputTokens;
        model = ev.model;
        stopReason = ev.stopReason;
        native = ev.native;
      }
    }

    if (stopReason !== "tool_use" || calls.length === 0) break;

    // Record the assistant's turn exactly as the provider produced it, then answer each call.
    const parts: ContentPart[] = [...(stepText ? [{ type: "text" as const, text: stepText }] : []), ...calls.map((c) => ({ type: "tool_use" as const, id: c.id, name: c.name, input: c.input }))];
    messages.push({ role: "assistant", content: parts, native });

    const results: ContentPart[] = [];
    for (const call of calls) {
      yield { type: "status", text: registry.label(call.name, call.input) };

      const pending: string[] = [];
      let wake: (() => void) | null = null;
      const report = (text: string) => {
        pending.push(text);
        wake?.();
      };
      const running = registry.execute(call.name, call.input, { ...input.toolContext, signal, report });
      let finished: Awaited<typeof running> | null = null;
      running.then((r) => {
        finished = r;
        wake?.();
      });
      while (!finished) {
        while (pending.length) yield { type: "status", text: pending.shift()! };
        if (finished) break;
        await new Promise<void>((resolve) => {
          wake = resolve;
          if (finished || pending.length) resolve();
        });
      }
      while (pending.length) yield { type: "status", text: pending.shift()! };

      const { result, record } = finished as Awaited<typeof running>;
      records.push(record);
      if (result.refs && Object.keys(result.refs).length) yield { type: "refs", refs: result.refs };
      results.push({ type: "tool_result", toolUseId: call.id, content: result.content, ...(result.ok ? {} : { isError: true }) });
    }
    messages.push({ role: "user", content: results });
    if (signal?.aborted) break;
  }

  yield { type: "done", stopReason, usage, model, tools: records };
}
