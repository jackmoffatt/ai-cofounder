import { z } from "zod";

/** Founder profile: each field is a short list of self-reported facts. */
export const FOUNDER_FIELDS = [
  { key: "background", label: "Background", hint: "Education, jobs, relevant experience" },
  { key: "skills", label: "Skills", hint: "Technical and business capabilities" },
  { key: "interests", label: "Interests", hint: "What you're drawn to" },
  { key: "industries", label: "Industries you know", hint: "Domains where you have insight" },
  { key: "resources", label: "Resources", hint: "Time, money, tools, assets" },
  { key: "constraints", label: "Constraints", hint: "What limits what you can do" },
  { key: "network", label: "Network and access", hint: "People and customer groups you can reach" },
  { key: "goals", label: "Goals", hint: "What you want from this" },
  { key: "workingStyle", label: "Working style", hint: "Preferences, availability, risk tolerance" },
] as const;

export type FounderFieldKey = (typeof FOUNDER_FIELDS)[number]["key"];
export const FOUNDER_FIELD_KEYS = FOUNDER_FIELDS.map((f) => f.key) as [FounderFieldKey, ...FounderFieldKey[]];

export type FounderProfile = Partial<Record<FounderFieldKey, string[]>>;

export const MAX_ITEMS_PER_FIELD = 25;
export const MAX_ITEM_LENGTH = 200;

const item = z.string().trim().min(1).max(MAX_ITEM_LENGTH);
export const FounderProfileSchema = z.object(
  Object.fromEntries(FOUNDER_FIELD_KEYS.map((k) => [k, z.array(item).max(MAX_ITEMS_PER_FIELD).optional()])),
) as z.ZodType<FounderProfile>;

/** Startup profile: free-text fields the founder writes. Unverified until backed by evidence (M3). */
export const STARTUP_FIELDS = [
  { key: "description", label: "Description" },
  { key: "mission", label: "Mission" },
  { key: "problem", label: "Problem" },
  { key: "targetCustomer", label: "Target customer" },
  { key: "solution", label: "Solution" },
  { key: "valueProposition", label: "Value proposition" },
  { key: "businessModel", label: "Business model" },
  { key: "pricingHypothesis", label: "Pricing hypothesis" },
  { key: "productStatus", label: "Product status" },
  { key: "distribution", label: "Distribution strategy" },
] as const;

export type StartupFieldKey = (typeof STARTUP_FIELDS)[number]["key"];
export type StartupProfile = Partial<Record<StartupFieldKey, string>>;

export const StartupProfileSchema = z.object(
  Object.fromEntries(STARTUP_FIELDS.map((f) => [f.key, z.string().trim().max(2000).optional()])),
) as z.ZodType<StartupProfile>;

export const STAGES = [
  { key: "discovery", label: "Discovery", hint: "Finding interesting problem spaces" },
  { key: "problem_research", label: "Problem research", hint: "Who has the problem, how badly" },
  { key: "market_research", label: "Market research", hint: "Market, competitors, pricing" },
  { key: "validation", label: "Validation", hint: "Testing assumptions with experiments" },
  { key: "product_definition", label: "Product definition", hint: "Customer, value proposition, MVP" },
  { key: "product_development", label: "Product development", hint: "Building what's validated" },
  { key: "go_to_market", label: "Go-to-market", hint: "Positioning, pricing, first customers" },
  { key: "learning_iteration", label: "Learning and iteration", hint: "Feedback, metrics, adjustments" },
] as const;

export type StageKey = (typeof STAGES)[number]["key"];
export const STAGE_KEYS = STAGES.map((s) => s.key) as [StageKey, ...StageKey[]];
export const stageLabel = (key: string) => STAGES.find((s) => s.key === key)?.label ?? key;

export function founderFieldCount(profile: FounderProfile): number {
  return Object.values(profile).filter((v) => v && v.length > 0).length;
}
