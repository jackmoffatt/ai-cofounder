"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import type { BriefOverview } from "@/services/brief/view";
import { BriefSection } from "./BriefSection";
import { EditableField } from "@/components/ui/EditableField";
import { Input } from "@/components/ui/Input";
import {
  FOUNDER_FIELDS,
  STAGES,
  STARTUP_FIELDS,
  type FounderProfile,
  type StartupProfile,
} from "@/lib/profile";

export interface StartupData {
  id: string;
  name: string;
  stage: string;
  currentObjective: string;
  profile: StartupProfile;
}

async function send(method: string, url: string, body: unknown): Promise<unknown> {
  const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(String(res.status));
  return res.json();
}

const lines = (s: string) => s.split("\n").map((l) => l.trim()).filter(Boolean);

export function StartupPage({
  initialFounder,
  initialStartup,
  initialBrief,
}: {
  initialFounder: { name: string | null; profile: FounderProfile };
  initialStartup: StartupData | null;
  initialBrief: BriefOverview;
}) {
  const [startup, setStartup] = useState(initialStartup);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  async function establish() {
    if (!newName.trim()) return;
    setCreating(true);
    setCreateError(null);
    try {
      const res = (await send("POST", "/api/startup", { name: newName })) as { startup: StartupData };
      setStartup(res.startup);
    } catch {
      setCreateError("Couldn't create the startup. Try again.");
    } finally {
      setCreating(false);
    }
  }

  const patchStartup = async (patch: object) => {
    const res = (await send("PATCH", "/api/startup", patch)) as { startup: StartupData };
    setStartup(res.startup);
  };

  const stage = STAGES.find((s) => s.key === startup?.stage);

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-[720px] px-4 pb-24 pt-16">
        <h1 className="text-[length:var(--fs-2xl)] font-semibold tracking-tight">Startup</h1>
        <p className="mt-1 text-sm text-muted">
          What your co-founder knows. It reads this before every reply, so keep it honest: what you believe is fine, just
          don&apos;t write it as proven.
        </p>

        <BriefSection initial={initialBrief} />

        <section className="mt-14 space-y-6" aria-labelledby="startup-heading">
          <h2 id="startup-heading" className="text-[length:var(--fs-xl)] font-semibold">
            The company
          </h2>

          {!startup ? (
            <div className="rounded-lg bg-surface-2 p-5">
              <p className="text-[length:var(--fs-base)]">
                No startup yet. That&apos;s fine: you can explore problems and ideas in chat first. When one is serious
                enough, establish it here.
              </p>
              <form
                className="mt-4 flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  void establish();
                }}
              >
                <Input
                  aria-label="Startup name"
                  placeholder="Working name"
                  value={newName}
                  maxLength={80}
                  onChange={(e) => setNewName(e.target.value)}
                />
                <Button type="submit" variant="primary" disabled={creating || !newName.trim()}>
                  Establish
                </Button>
              </form>
              {createError && <p role="alert" className="mt-2 text-sm text-muted">{createError}</p>}
            </div>
          ) : (
            <>
              <EditableField label="Name" value={startup.name} onSave={(v) => patchStartup({ name: v })} />

              <div>
                <label htmlFor="stage" className="text-sm font-medium">
                  Stage
                </label>
                <select
                  id="stage"
                  value={startup.stage}
                  onChange={(e) => void patchStartup({ stage: e.target.value })}
                  className="mt-1.5 block h-9 w-full rounded-md border border-line bg-surface px-3 text-[length:var(--fs-base)] focus:border-accent focus:outline-none"
                >
                  {STAGES.map((s, i) => (
                    <option key={s.key} value={s.key}>
                      {i + 1}. {s.label}
                    </option>
                  ))}
                </select>
                {stage && <p className="mt-1 text-xs text-muted">{stage.hint}</p>}
                <p className="text-xs text-muted">Startups move backward as well as forward.</p>
              </div>

              <EditableField
                label="Current objective"
                hint="The one thing the next few weeks are for."
                value={startup.currentObjective}
                placeholder="e.g. Find out whether 10 students actually have this problem"
                onSave={(v) => patchStartup({ currentObjective: v })}
              />

              {STARTUP_FIELDS.map((f) => (
                <EditableField
                  key={f.key}
                  label={f.label}
                  value={startup.profile[f.key] ?? ""}
                  rows={2}
                  onSave={(v) => patchStartup({ profile: { [f.key]: v } })}
                />
              ))}
            </>
          )}
        </section>

        <section className="mt-14 space-y-6" aria-labelledby="you-heading">
          <div>
            <h2 id="you-heading" className="text-[length:var(--fs-xl)] font-semibold">
              You
            </h2>
            <p className="mt-1 text-sm text-muted">
              Your co-founder fits its advice to this. It also adds things you mention in chat; you&apos;ll see each one
              and can undo it. One item per line.
            </p>
          </div>

          <EditableField
            label="Name"
            value={initialFounder.name ?? ""}
            onSave={async (v) => void (await send("PATCH", "/api/founder", { name: v.trim() || null }))}
          />
          {FOUNDER_FIELDS.map((f) => (
            <EditableField
              key={f.key}
              label={f.label}
              hint={f.hint}
              rows={2}
              value={(initialFounder.profile[f.key] ?? []).join("\n")}
              onSave={async (v) => void (await send("PATCH", "/api/founder", { profile: { [f.key]: lines(v) } }))}
            />
          ))}
        </section>
      </div>
    </div>
  );
}
