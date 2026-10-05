import type { ZodType } from "zod";
import type { Db } from "@/db/client";
import type { AIProvider } from "@/services/ai/types";
import type { PageFetcher } from "@/services/research/fetcher";
import type { SearchBackend } from "@/services/research/search";

/**
 * How consequential a tool is, which decides how it is run:
 *  - read: looks things up; runs immediately
 *  - write_internal: changes only this app's own data; runs immediately and is audited
 *  - external: affects the outside world (email, posting, spending); never runs without the founder's approval
 */
export type Risk = "read" | "write_internal" | "external";

export interface ToolContext {
  db: Db;
  provider: AIProvider;
  conversationId: string;
  signal?: AbortSignal;
  /** Shows a short status to the user while the tool works ("Reading 5 pages…"). */
  report: (status: string) => void;
  /** Overridable in tests and offline development. */
  research?: { search: SearchBackend; fetcher: PageFetcher };
}

export interface ToolResult {
  ok: boolean;
  /** What the model sees. */
  content: string;
  /** Memory items the result refers to, so the UI can turn citations into links. */
  refs?: Record<string, { id: string; kind: string; title: string }>;
}

export interface Tool<A = unknown> {
  name: string;
  /** Shown to the model: what it does and when to use it. */
  description: string;
  input: ZodType<A>;
  risk: Risk;
  /** Status line shown while it runs. */
  label?: (args: A) => string;
  /** For external tools: a plain description of what approving would do. */
  describeForApproval?: (args: A) => string;
  execute(args: A, ctx: ToolContext): Promise<ToolResult>;
}

export interface ToolCallRecord {
  name: string;
  /** Short, non-sensitive summary of the arguments. */
  args: string;
  ok: boolean;
  ms: number;
  approvalId?: string;
}
