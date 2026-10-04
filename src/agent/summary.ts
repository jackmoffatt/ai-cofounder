import type { Db } from "@/db/client";
import { getConversation, listMessages, setSummary } from "@/db/queries/conversations";
import { modelFor } from "@/services/ai/models";
import type { AIProvider } from "@/services/ai/types";

/** Messages kept verbatim at the end of the conversation; older ones are folded into the summary. */
export const WINDOW = 16;
/** Don't call the model for fewer than this many newly-outside-the-window messages. */
export const MIN_BATCH = 4;

const SYSTEM = `You maintain a running summary of a conversation between a startup founder and their AI co-founder. Update the summary to include the new messages.

Keep it under 200 words, as plain prose or short bullets. Capture: what was discussed, positions and conclusions reached, open threads, and what the founder wants next. Attribute claims ("the founder believes…", "the founder reported…"); never turn a belief into a fact. Do not invent anything. Output only the updated summary.`;

/**
 * Folds the oldest unsummarised messages into the conversation's rolling summary. Returns whether it
 * updated. Never throws: a failed summary just means more raw messages are sent next time.
 */
export async function updateSummary(db: Db, provider: AIProvider, conversationId: string): Promise<boolean> {
  const conv = getConversation(db, conversationId);
  if (!conv) return false;
  const messages = listMessages(db, conversationId);
  const upTo = messages.length - WINDOW;
  if (upTo - conv.summaryCount < MIN_BATCH) return false;

  const chunk = messages.slice(conv.summaryCount, upTo);
  try {
    const { text } = await provider.complete({
      model: modelFor("summarize"),
      system: SYSTEM,
      messages: [
        {
          role: "user",
          content: `Current summary:\n${conv.summary || "(none yet)"}\n\nNew messages:\n${chunk
            .map((m) => `${m.role === "user" ? "Founder" : "Co-founder"}: ${m.content.slice(0, 1500)}`)
            .join("\n\n")}`,
        },
      ],
      maxTokens: 500,
    });
    const summary = text.trim();
    if (!summary) return false;
    setSummary(db, conversationId, summary, upTo);
    return true;
  } catch (err) {
    console.error("summary update failed:", err instanceof Error ? err.name : "unknown");
    return false;
  }
}
