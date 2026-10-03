import type { Db } from "@/db/client";
import {
  FOUNDER_FIELDS,
  STARTUP_FIELDS,
  founderFieldCount,
  stageLabel,
} from "@/lib/profile";
import { readFounder } from "@/services/memory/founder";
import { readActiveStartup } from "@/services/memory/startup";
import { SYSTEM_PROMPT } from "./systemPrompt";

/** Below this many filled profile fields (and with no startup), the agent leans into discovery. */
const SPARSE_FOUNDER_FIELDS = 4;

/**
 * Builds the system prompt for a turn: persona + what we know about the founder and startup.
 * M2 includes everything (it is small); M4 turns this into budgeted, intent-driven retrieval.
 */
export function buildSystemPrompt(db: Db): string {
  const founder = readFounder(db);
  const startup = readActiveStartup(db);
  const parts: string[] = [SYSTEM_PROMPT];

  const founderLines = FOUNDER_FIELDS.flatMap((f) => {
    const items = founder.profile[f.key];
    return items?.length ? [`- ${f.label}: ${items.join("; ")}`] : [];
  });
  if (founder.name) founderLines.unshift(`- Name: ${founder.name}`);
  parts.push(
    founderLines.length
      ? `## About the founder\nThis is what the founder has told you about themselves.\n${founderLines.join("\n")}\n\nShape recommendations around what is realistic for this person. If a suggestion conflicts with something above, say so rather than ignoring it.`
      : "## About the founder\nYou know nothing about the founder yet.",
  );

  if (startup) {
    const lines = [
      `- Name: ${startup.name}`,
      `- Stage: ${stageLabel(startup.stage)}`,
      `- Current objective: ${startup.currentObjective || "not set"}`,
      ...STARTUP_FIELDS.flatMap((f) => (startup.profile[f.key] ? [`- ${f.label}: ${startup.profile[f.key]}`] : [])),
    ];
    parts.push(
      `## The startup\nThese are the founder's own statements. They are beliefs and intentions, not verified facts, until backed by evidence. Treat them accordingly.\n${lines.join("\n")}`,
    );
  } else {
    parts.push(
      "## The startup\nNo startup has been established yet. The founder is still exploring. Do not assume or invent an idea.",
    );
  }

  if (!startup && founderFieldCount(founder.profile) + (founder.name ? 1 : 0) < SPARSE_FOUNDER_FIELDS) {
    parts.push(
      "## This conversation\nYou are still getting to know the founder. Answer what they ask, and also weave in one or two natural discovery questions (interests, skills, resources, constraints, problems they've noticed). Never ask more than two questions at once, and never present a questionnaire.",
    );
  }

  return parts.join("\n\n");
}
