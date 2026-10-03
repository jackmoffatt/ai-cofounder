import { modelFor } from "@/services/ai/models";
import type { AIProvider } from "@/services/ai/types";

const TITLE_SYSTEM =
  "Write a short title (2 to 5 words) for a conversation, based on its first message. Reply with only the title: no quotes, no trailing punctuation.";

export function fallbackTitle(message: string): string {
  const clean = message.replace(/\s+/g, " ").trim();
  return clean.length <= 40 ? clean : `${clean.slice(0, 40).trimEnd()}…`;
}

export function cleanTitle(raw: string): string {
  return raw.replace(/^["'“”‘’\s]+|["'“”‘’.\s]+$/g, "").replace(/\s+/g, " ").slice(0, 60);
}

/** Never throws: a failed title call falls back to the start of the message. */
export async function generateTitle(provider: AIProvider, firstMessage: string): Promise<string> {
  try {
    const { text } = await provider.complete({
      model: modelFor("title"),
      system: TITLE_SYSTEM,
      messages: [{ role: "user", content: firstMessage.slice(0, 2000) }],
      maxTokens: 30,
    });
    return cleanTitle(text) || fallbackTitle(firstMessage);
  } catch {
    return fallbackTitle(firstMessage);
  }
}
