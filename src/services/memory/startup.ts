import type { Db } from "@/db/client";
import { createStartup, getActiveStartup, insertEvent, updateStartup } from "@/db/queries/profile";
import type { Startup } from "@/db/schema";
import {
  STARTUP_FIELDS,
  StartupProfileSchema,
  stageLabel,
  type StageKey,
  type StartupProfile,
} from "@/lib/profile";

export interface StartupView {
  id: string;
  name: string;
  stage: string;
  currentObjective: string;
  profile: StartupProfile;
}

export function toView(row: Startup): StartupView {
  let profile: StartupProfile = {};
  try {
    const parsed = StartupProfileSchema.safeParse(JSON.parse(row.profile));
    if (parsed.success) profile = parsed.data;
  } catch {
    /* corrupt JSON: treat as empty */
  }
  return { id: row.id, name: row.name, stage: row.stage, currentObjective: row.currentObjective, profile };
}

export function readActiveStartup(db: Db): StartupView | null {
  const row = getActiveStartup(db);
  return row ? toView(row) : null;
}

export function establishStartup(db: Db, name: string): StartupView {
  const row = createStartup(db, name.trim());
  insertEvent(db, {
    entityType: "startup",
    entityId: row.id,
    action: "create",
    actor: "user",
    summary: `Established startup: ${row.name}`,
    reason: "Created by you",
  });
  return toView(row);
}

export interface StartupPatch {
  name?: string;
  stage?: StageKey;
  currentObjective?: string;
  profile?: StartupProfile;
}

/** Founder edits their startup. Strategic fields are the founder's call, so no confirmation step here. */
export function saveStartupEdit(db: Db, id: string, patch: StartupPatch): StartupView | null {
  const row = getActiveStartup(db);
  if (!row || row.id !== id) return null;
  const current = toView(row);
  const changes: string[] = [];
  const update: Parameters<typeof updateStartup>[2] = {};

  if (patch.name !== undefined && patch.name.trim() && patch.name.trim() !== current.name) {
    update.name = patch.name.trim();
    changes.push(`name → ${update.name}`);
  }
  if (patch.stage && patch.stage !== current.stage) {
    update.stage = patch.stage;
    changes.push(`stage: ${stageLabel(current.stage)} → ${stageLabel(patch.stage)}`);
  }
  if (patch.currentObjective !== undefined && patch.currentObjective.trim() !== current.currentObjective) {
    update.currentObjective = patch.currentObjective.trim();
    changes.push("current objective");
  }
  if (patch.profile) {
    const next: StartupProfile = { ...current.profile };
    for (const f of STARTUP_FIELDS) {
      const v = patch.profile[f.key];
      if (v !== undefined && v.trim() !== (current.profile[f.key] ?? "")) {
        next[f.key] = v.trim();
        changes.push(f.label.toLowerCase());
      }
    }
    update.profile = JSON.stringify(next);
  }
  if (!changes.length) return current;

  const saved = updateStartup(db, id, update);
  insertEvent(db, {
    entityType: "startup",
    entityId: id,
    action: "update",
    actor: "user",
    summary: `Edited: ${changes.join(", ")}`,
    reason: "Edited directly by you",
  });
  return saved ? toView(saved) : null;
}
