import { z } from "zod";
import { insertApproval } from "@/db/queries/tools";
import type { ToolSpec } from "@/services/ai/types";
import type { Tool, ToolCallRecord, ToolContext, ToolResult } from "./types";

export interface ExecutedTool {
  result: ToolResult;
  record: ToolCallRecord;
}

const MAX_RESULT_CHARS = 12_000;

/** JSON Schema for the model, without the `$schema` marker some providers reject. */
function schemaFor(tool: Tool): Record<string, unknown> {
  const { $schema: _ignored, ...rest } = z.toJSONSchema(tool.input) as Record<string, unknown>;
  void _ignored;
  return rest;
}

const summarize = (args: unknown): string => {
  try {
    const s = JSON.stringify(args) ?? "";
    return s.length > 160 ? `${s.slice(0, 157)}…` : s;
  } catch {
    return "";
  }
};

/**
 * The set of tools the agent can use. Each tool declares its risk; the registry is where that is
 * enforced, so a tool can't opt out of approval.
 */
export class ToolRegistry {
  private readonly tools = new Map<string, Tool<never>>();

  register<A>(tool: Tool<A>): this {
    if (this.tools.has(tool.name)) throw new Error(`Tool already registered: ${tool.name}`);
    this.tools.set(tool.name, tool as unknown as Tool<never>);
    return this;
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name) as unknown as Tool | undefined;
  }

  /** Definitions to send to the model for the named tools (unknown names are ignored). */
  specs(names: string[]): ToolSpec[] {
    return names.flatMap((n) => {
      const t = this.get(n);
      return t ? [{ name: t.name, description: t.description, inputSchema: schemaFor(t) }] : [];
    });
  }

  label(name: string, rawArgs: unknown): string {
    const t = this.get(name);
    const parsed = t?.input.safeParse(rawArgs);
    return t?.label && parsed?.success ? t.label(parsed.data) : "Working…";
  }

  /**
   * Validates arguments, applies the risk policy, runs the tool, and always returns a result the model
   * can read: failures become error results rather than exceptions.
   */
  async execute(name: string, rawArgs: unknown, ctx: ToolContext): Promise<ExecutedTool> {
    const started = Date.now();
    const done = (result: ToolResult, extra: Partial<ToolCallRecord> = {}): ExecutedTool => ({
      result: { ...result, content: result.content.slice(0, MAX_RESULT_CHARS) },
      record: { name, args: summarize(rawArgs), ok: result.ok, ms: Date.now() - started, ...extra },
    });

    const tool = this.get(name);
    if (!tool) return done({ ok: false, content: `There is no tool called "${name}".` });

    const parsed = tool.input.safeParse(rawArgs);
    if (!parsed.success) {
      return done({ ok: false, content: `Invalid arguments for ${name}: ${parsed.error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ")}` });
    }

    if (tool.risk === "external") {
      const approval = insertApproval(ctx.db, { tool: name, args: JSON.stringify(parsed.data), summary: tool.describeForApproval?.(parsed.data) ?? `Run ${name}` });
      return done(
        { ok: false, content: "This action affects the outside world, so it needs the founder's approval. It has been queued for them and has NOT been done. Tell the founder it is waiting for their approval; do not say it happened." },
        { approvalId: approval.id },
      );
    }

    try {
      return done(await tool.execute(parsed.data, ctx));
    } catch (err) {
      console.error(`tool ${name} failed:`, err instanceof Error ? err.name : "unknown");
      return done({ ok: false, content: `The ${name} tool failed unexpectedly. Tell the founder it didn't work.` });
    }
  }
}
