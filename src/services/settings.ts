import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { settings } from "@/db/schema";
import { MODEL_ROLES, isValidModelId, setModelOverrides, type ModelRole } from "@/services/ai/models";

const KEY = "model_overrides";

export class SettingsError extends Error {}

export function readModelOverrides(db: Db): Partial<Record<ModelRole, string>> {
  const row = db.select().from(settings).where(eq(settings.key, KEY)).get();
  if (!row) return {};
  try {
    const parsed = JSON.parse(row.value) as Record<string, unknown>;
    return Object.fromEntries(MODEL_ROLES.flatMap((r) => (typeof parsed[r] === "string" && isValidModelId(parsed[r] as string) ? [[r, parsed[r]]] : [])));
  } catch {
    return {};
  }
}

/** Applies saved overrides to the running process. Call once when the database opens. */
export function loadModelOverrides(db: Db): void {
  setModelOverrides(readModelOverrides(db));
}

/** Sets (or, with null/empty, clears) the model used for one role. Takes effect immediately. */
export function saveModelOverride(db: Db, role: ModelRole, model: string | null): Partial<Record<ModelRole, string>> {
  if (!MODEL_ROLES.includes(role)) throw new SettingsError("Unknown role");
  const next = { ...readModelOverrides(db) };
  const id = model?.trim() ?? "";
  if (id) {
    if (!isValidModelId(id)) throw new SettingsError("That doesn't look like a model ID (letters, numbers, dots, dashes).");
    next[role] = id;
  } else {
    delete next[role];
  }
  const row = { key: KEY, value: JSON.stringify(next), updatedAt: new Date().toISOString() };
  db.insert(settings).values(row).onConflictDoUpdate({ target: settings.key, set: { value: row.value, updatedAt: row.updatedAt } }).run();
  setModelOverrides(next);
  return next;
}
