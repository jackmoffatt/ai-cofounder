"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { cn } from "@/lib/cn";
import { ACCENTS, useAccent } from "@/lib/accent";
import { notifyConversationsChanged } from "@/lib/chatClient";
import { api, notifyMemoryChanged, timeAgo } from "@/lib/memoryClient";
import { SHORTCUTS, useIsMac } from "@/lib/platform";
import type { ThemePreference } from "@/lib/theme";
import { setDebugMode, useDebugMode } from "@/lib/useDebugMode";
import { useTheme } from "@/lib/useTheme";
import type { HealthReport } from "@/services/health";
import type { TrashEntry } from "@/services/trash";

type Model = HealthReport["models"][number];

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="mt-12" aria-label={title}>
      <h2 className="text-[length:var(--fs-xl)] font-semibold">{title}</h2>
      {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Status({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <li className="flex items-baseline gap-2 text-sm">
      <span aria-hidden className={cn("mt-1.5 size-2 shrink-0 rounded-full", ok ? "bg-accent" : "bg-muted/50")} />
      <span>{children}</span>
    </li>
  );
}

function ModelRow({ m, onChange }: { m: Model; onChange: (h: HealthReport) => void }) {
  const [value, setValue] = useState(m.source === "setting" ? m.model : "");
  const [msg, setMsg] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);

  async function save(next: string | null) {
    setMsg(null);
    try {
      onChange(await api<HealthReport>("PATCH", "/api/settings/models", { role: m.role, model: next }));
      if (next === null) setValue("");
    } catch (e) {
      setMsg(e instanceof Error && e.message.length > 3 ? e.message : "Couldn't save that.");
    }
  }

  async function test() {
    setTesting(true);
    setMsg(null);
    try {
      const r = await api<{ ok: boolean; model: string; ms: number; message?: string }>("POST", "/api/settings/test", { role: m.role });
      setMsg(r.ok ? `Works · ${r.model} · ${(r.ms / 1000).toFixed(1)}s` : (r.message ?? "That didn't work."));
    } catch {
      setMsg("Couldn't run the test.");
    } finally {
      setTesting(false);
    }
  }

  return (
    <li className="py-3">
      <div className="flex items-baseline justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[length:var(--fs-base)]">{m.label}</p>
          <p className="text-xs text-muted">{m.description}</p>
        </div>
        <p className="shrink-0 text-xs text-muted">
          {m.model} <span className="opacity-70">({m.source})</span>
        </p>
      </div>
      <div className="mt-2 flex gap-2">
        <Input
          aria-label={`Model for ${m.label}`}
          placeholder={m.defaultModel}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={() => value.trim() !== (m.source === "setting" ? m.model : "") && void save(value.trim() || null)}
        />
        {m.source === "setting" && (
          <Button variant="ghost" onClick={() => void save(null)}>
            Reset
          </Button>
        )}
        <Button variant="ghost" disabled={testing} onClick={() => void test()}>
          {testing ? "Testing…" : "Test"}
        </Button>
      </div>
      {msg && (
        <p role="status" className="mt-1 text-xs text-muted">
          {msg}
        </p>
      )}
    </li>
  );
}

export function SettingsPage({ initialHealth, initialTrash }: { initialHealth: HealthReport; initialTrash: TrashEntry[] }) {
  const router = useRouter();
  const { preference, setPreference } = useTheme();
  const { accent, setAccent } = useAccent();
  const debug = useDebugMode();
  const mac = useIsMac();
  const [health, setHealth] = useState(initialHealth);
  const [trash, setTrash] = useState(initialTrash);
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [wiping, setWiping] = useState(false);

  async function trashAction(action: "restore" | "purge", e: TrashEntry) {
    setError(null);
    if (action === "purge" && !window.confirm(`Delete “${e.title}” for good? This can't be undone.`)) return;
    try {
      await api("POST", "/api/trash", { action, type: e.type, id: e.id });
      setTrash((t) => t.filter((x) => !(x.id === e.id && x.type === e.type)));
    } catch {
      setError("Couldn't do that. Try again.");
    }
  }

  async function wipe() {
    setWiping(true);
    setError(null);
    try {
      await api("POST", "/api/data/delete", { confirm: "DELETE" });
      notifyConversationsChanged(); // the sidebar list is client state: tell it to reload
      notifyMemoryChanged();
      router.push("/");
      router.refresh(); // drop cached pages that still show the deleted data
    } catch {
      setError("Couldn't delete your data. Nothing was changed.");
      setWiping(false);
    }
  }

  const themes: ThemePreference[] = ["system", "light", "dark"];

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-[720px] px-4 pb-24 pt-16">
        <h1 className="text-[length:var(--fs-2xl)] font-semibold tracking-tight">Settings</h1>

        <Section title="Status" description="What's set up. Keys are read from .env.local and are never shown here.">
          <ul className="space-y-2">
            <Status ok={health.ai.keyConfigured}>
              {health.ai.provider === "fake" ? "AI: offline development mode (fake replies)" : health.ai.keyConfigured ? "AI: Anthropic API key found" : "AI: no ANTHROPIC_API_KEY. Add it to .env.local and restart."}
            </Status>
            <Status ok={health.search.configured}>
              {health.search.fake ? "Research: offline fixtures" : health.search.configured ? `Research: web search ready (${health.search.backend})` : `Research: search not set up (${health.search.backend})`}
            </Status>
            <Status ok={health.database.ok}>
              Database: {health.database.ok ? "working" : "problem"} · <span className="break-all text-muted">{health.database.path}</span>
            </Status>
          </ul>
        </Section>

        <Section title="Appearance">
          <div className="space-y-5">
            <div role="radiogroup" aria-label="Theme" className="inline-flex rounded-md bg-surface-2 p-0.5">
              {themes.map((t) => (
                <button
                  key={t}
                  role="radio"
                  aria-checked={preference === t}
                  onClick={() => setPreference(t)}
                  className={cn("rounded-[7px] px-3 py-1 text-sm capitalize transition-colors duration-[var(--dur-fast)]", preference === t ? "bg-surface text-fg shadow-sm" : "text-muted hover:text-fg")}
                >
                  {t}
                </button>
              ))}
            </div>
            <div role="radiogroup" aria-label="Accent colour" className="flex gap-3">
              {ACCENTS.map((a) => (
                <button
                  key={a.key}
                  role="radio"
                  aria-checked={accent === a.key}
                  aria-label={a.label}
                  title={a.label}
                  onClick={() => setAccent(a.key)}
                  style={{ backgroundColor: a.swatch }}
                  className={cn("size-6 rounded-full ring-offset-2 ring-offset-bg transition-shadow duration-[var(--dur-fast)]", accent === a.key && "ring-2 ring-fg")}
                />
              ))}
            </div>
          </div>
        </Section>

        <Section title="Models" description="Which model does each job. Change one and it applies to the next message. “Test” makes one tiny request to check the key and model ID.">
          <ul className="divide-y divide-line">
            {health.models.map((m) => (
              <ModelRow key={`${m.role}-${m.model}-${m.source}`} m={m} onChange={setHealth} />
            ))}
          </ul>
        </Section>

        <Section title="Developer">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={debug} onChange={(e) => setDebugMode(e.target.checked)} />
            Developer mode: show a trace under each reply (context sent, memory retrieved, tools called, tokens)
          </label>
        </Section>

        <Section title="Your data" description="It's yours. Everything lives in one local database file; nothing is sent anywhere except what each message needs for a reply.">
          <div className="space-y-6">
            <div>
              <a href="/api/export" download className="inline-flex h-9 items-center rounded-md bg-surface-2 px-4 text-sm font-medium transition-colors duration-[var(--dur-fast)] hover:bg-line">
                Export everything (JSON)
              </a>
              <p className="mt-1 text-xs text-muted">Conversations, memory with its history, tasks, research and sources. Includes anything you deleted but hasn&apos;t been erased yet.</p>
            </div>

            <div>
              <h3 className="text-sm font-medium">Recently deleted</h3>
              {trash.length === 0 ? (
                <p className="mt-1 text-sm text-muted">Nothing. Deleted items and tasks wait here until you erase them for good.</p>
              ) : (
                <ul className="mt-2 divide-y divide-line">
                  {trash.map((e) => (
                    <li key={`${e.type}-${e.id}`} className="flex items-center justify-between gap-3 py-2">
                      <span className="min-w-0 text-sm">
                        <span className="block truncate">{e.title}</span>
                        <span className="text-xs text-muted">
                          {e.kind} · deleted {timeAgo(e.deletedAt)}
                        </span>
                      </span>
                      <span className="flex shrink-0 gap-1">
                        <Button variant="ghost" onClick={() => void trashAction("restore", e)}>
                          Restore
                        </Button>
                        <Button variant="ghost" onClick={() => void trashAction("purge", e)}>
                          Erase
                        </Button>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="rounded-lg border border-line p-4">
              <h3 className="text-sm font-medium">Delete all my data</h3>
              <p className="mt-1 text-sm text-muted">Erases every conversation, memory, task, experiment and research finding. Your settings are kept. This can&apos;t be undone, so export first if you might want it.</p>
              <div className="mt-3 flex gap-2">
                <Input aria-label="Type DELETE to confirm" placeholder="Type DELETE to confirm" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
                <Button disabled={confirm !== "DELETE" || wiping} onClick={() => void wipe()}>
                  {wiping ? "Deleting…" : "Delete everything"}
                </Button>
              </div>
            </div>
            {error && (
              <p role="alert" className="text-sm text-muted">
                {error}
              </p>
            )}
          </div>
        </Section>

        <Section title="Keyboard">
          <ul className="space-y-1.5">
            {SHORTCUTS.map((s) => (
              <li key={s.label} className="flex items-baseline justify-between gap-4 text-sm">
                <span>{s.label}</span>
                <kbd className="shrink-0 rounded-sm bg-surface-2 px-1.5 py-0.5 text-xs text-muted">{s.mod ? `${mac ? "⌘" : "Ctrl+"}${s.keys}` : s.keys}</kbd>
              </li>
            ))}
          </ul>
        </Section>
      </div>
    </div>
  );
}
