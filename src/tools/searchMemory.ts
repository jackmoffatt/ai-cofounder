import { z } from "zod";
import { toFtsQuery } from "@/db/queries/conversations";
import { getItem, searchItemIds } from "@/db/queries/memory";
import { refFor } from "@/lib/memory";
import type { Tool } from "./types";

const Args = z.object({ query: z.string().min(2).max(200).describe("Words to look for in recorded knowledge.") });

/** Keyword search over everything recorded: assumptions, decisions, research, and so on. */
export const searchMemory: Tool<z.infer<typeof Args>> = {
  name: "search_memory",
  description:
    "Search the recorded knowledge (assumptions, decisions, questions, ideas, customer insights, research findings) by keyword, including closed and older items. Use it when the founder asks about something earlier that isn't in the context you were given. Cite results with their [m:handle].",
  input: Args,
  risk: "read",
  label: (a) => `Checking memory: ${a.query}`,
  async execute(args, ctx) {
    const fts = toFtsQuery(args.query, "or");
    const items = fts ? searchItemIds(ctx.db, fts, 8).flatMap((id) => { const i = getItem(ctx.db, id); return i && !i.deletedAt ? [i] : []; }) : [];
    if (!items.length) return { ok: true, content: `Nothing recorded matches "${args.query}".` };
    const refs: Record<string, { id: string; kind: string; title: string }> = {};
    const lines = items.map((i) => {
      refs[refFor(i.id)] = { id: i.id, kind: i.kind, title: i.title };
      return `- [m:${refFor(i.id)}] ${i.title} (${i.kind} · ${i.status}${i.kind === "assumption" || i.kind === "research" ? ` · ${i.confidence} confidence` : ""})`;
    });
    return { ok: true, content: `Recorded knowledge matching "${args.query}":\n${lines.join("\n")}`, refs };
  },
};
