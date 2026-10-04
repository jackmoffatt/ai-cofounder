"use client";

import { Check } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { ContextPanel } from "@/components/context/ContextPanel";
import { EditableField } from "@/components/ui/EditableField";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import { MEMORY_CHANGED, api, notifyMemoryChanged } from "@/lib/memoryClient";
import { isOpen } from "@/lib/work";
import type { TaskView } from "@/services/work/tasks";
import type { WorkOverview } from "@/services/work/view";
import { ExperimentPanel } from "./ExperimentPanel";
import { TaskPanel } from "./TaskPanel";

type Open = { type: "task" | "experiment"; id: string } | null;

function TaskRow({ task, onOpen, onToggle }: { task: TaskView; onOpen: () => void; onToggle: () => void }) {
  const done = task.status === "done";
  const meta = [task.priority !== "medium" ? task.priority : null, task.category !== "other" ? task.category : null, task.dueDate ? `${task.overdue ? "overdue · " : ""}due ${task.dueDate}` : null, task.blockedBy[0] ? `waiting on “${task.blockedBy[0].title}”` : null]
    .filter(Boolean)
    .join(" · ");
  return (
    <li className="flex items-start gap-3 rounded-md px-3 py-2 transition-colors duration-[var(--dur-fast)] hover:bg-surface-2">
      <button
        aria-label={done ? `Reopen ${task.title}` : `Complete ${task.title}`}
        onClick={onToggle}
        className={cn("mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full border transition-colors duration-[var(--dur-fast)]", done ? "border-accent bg-accent text-accent-fg" : "border-line hover:border-accent")}
      >
        {done && <Check size={12} strokeWidth={3} />}
      </button>
      <button onClick={onOpen} className="min-w-0 flex-1 text-left">
        <span className={cn("block text-[length:var(--fs-base)]", done && "text-muted line-through")}>{task.title}</span>
        {meta && <span className={cn("block text-xs", task.overdue && !done ? "text-fg" : "text-muted")}>{meta}</span>}
      </button>
    </li>
  );
}

function TaskSection({ label, list, onOpen, onToggle }: { label: string; list: TaskView[]; onOpen: (id: string) => void; onToggle: (t: TaskView) => void }) {
  if (list.length === 0) return null;
  return (
    <section className="mt-6" aria-label={label}>
      <h2 className="px-3 text-[11px] font-medium uppercase tracking-wider text-muted">{label}</h2>
      <ul className="mt-1">
        {list.map((t) => (
          <TaskRow key={t.id} task={t} onOpen={() => onOpen(t.id)} onToggle={() => onToggle(t)} />
        ))}
      </ul>
    </section>
  );
}

export function TasksPage({ initial }: { initial: WorkOverview }) {
  const [work, setWork] = useState(initial);
  const [open, setOpen] = useState<Open>(null);
  const [title, setTitle] = useState("");
  const [showDone, setShowDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [objectiveTitle, setObjectiveTitle] = useState("");
  const [exp, setExp] = useState({ hypothesis: "", assumptionId: "" });

  const reload = useCallback(async () => {
    try {
      setWork(await api<WorkOverview>("GET", "/api/work"));
    } catch {
      /* keep what we have */
    }
  }, []);
  useEffect(() => {
    window.addEventListener(MEMORY_CHANGED, reload);
    return () => window.removeEventListener(MEMORY_CHANGED, reload);
  }, [reload]);

  async function act(fn: () => Promise<unknown>) {
    setError(null);
    try {
      await fn();
      await reload();
      notifyMemoryChanged();
    } catch (e) {
      setError(e instanceof Error && e.message.length > 3 ? e.message : "Couldn't save. Try again.");
    }
  }

  const tasks = work.tasks;
  const openTasks = tasks.filter((t) => isOpen(t.status));
  const doing = openTasks.filter((t) => t.effectiveStatus === "doing");
  const blocked = openTasks.filter((t) => t.effectiveStatus === "blocked");
  const next = openTasks.filter((t) => t.effectiveStatus === "todo");
  const done = tasks.filter((t) => t.status === "done").sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? "")).slice(0, 15);
  const toggle = (t: TaskView) => act(() => api("PATCH", `/api/tasks/${t.id}`, { status: t.status === "done" ? "todo" : "done" }));

  const openTask = open?.type === "task" ? tasks.find((t) => t.id === open.id) : undefined;
  const openExp = open?.type === "experiment" ? work.experiments.find((e) => e.id === open.id) : undefined;
  const objective = work.objective;

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-[720px] px-4 pb-24 pt-16">
        <h1 className="text-[length:var(--fs-2xl)] font-semibold tracking-tight">Tasks</h1>

        <section aria-labelledby="objective-heading" className="mt-6 rounded-lg bg-surface-2 p-4">
          <p id="objective-heading" className="text-xs uppercase tracking-wider text-muted">
            Current objective
          </p>
          {objective ? (
            <div className="mt-2 space-y-3">
              <EditableField label="Objective" value={objective.title} onSave={(v) => act(() => api("PATCH", `/api/objectives/${objective.id}`, { title: v }))} />
              <EditableField label="Success looks like" value={objective.successCriteria} rows={2} onSave={(v) => act(() => api("PATCH", `/api/objectives/${objective.id}`, { successCriteria: v }))} />
              <div className="flex gap-2">
                <Button variant="ghost" onClick={() => void act(() => api("PATCH", `/api/objectives/${objective.id}`, { status: "achieved" }))}>
                  Mark achieved
                </Button>
                <Button variant="ghost" onClick={() => void act(() => api("PATCH", `/api/objectives/${objective.id}`, { status: "dropped" }))}>
                  Drop
                </Button>
              </div>
            </div>
          ) : (
            <form
              className="mt-2 flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (!objectiveTitle.trim()) return;
                void act(() => api("POST", "/api/objectives", { title: objectiveTitle })).then(() => setObjectiveTitle(""));
              }}
            >
              <Input aria-label="Objective" placeholder="What is the next few weeks for?" value={objectiveTitle} maxLength={200} onChange={(e) => setObjectiveTitle(e.target.value)} />
              <Button type="submit" disabled={!objectiveTitle.trim()}>
                Set
              </Button>
            </form>
          )}
        </section>

        <form
          className="mt-6"
          onSubmit={(e) => {
            e.preventDefault();
            if (!title.trim()) return;
            void act(() => api("POST", "/api/tasks", { title })).then(() => setTitle(""));
          }}
        >
          <Input aria-label="Add task" placeholder="Add a task…" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} />
        </form>
        {error && (
          <p role="alert" className="mt-2 text-sm text-muted">
            {error}
          </p>
        )}

        {openTasks.length === 0 && <p className="mt-6 px-3 text-sm text-muted">Nothing open. Tell your co-founder what you need to do, or ask for a plan.</p>}
        <TaskSection label="Doing" list={doing} onOpen={(id) => setOpen({ type: "task", id })} onToggle={(t) => void toggle(t)} />
        <TaskSection label="Next" list={next} onOpen={(id) => setOpen({ type: "task", id })} onToggle={(t) => void toggle(t)} />
        <TaskSection label="Blocked" list={blocked} onOpen={(id) => setOpen({ type: "task", id })} onToggle={(t) => void toggle(t)} />

        {done.length > 0 && (
          <section className="mt-6">
            <button onClick={() => setShowDone((s) => !s)} className="px-3 text-[11px] font-medium uppercase tracking-wider text-muted hover:text-fg">
              Completed ({done.length}) {showDone ? "▾" : "▸"}
            </button>
            {showDone && (
              <ul className="mt-1">
                {done.map((t) => (
                  <TaskRow key={t.id} task={t} onOpen={() => setOpen({ type: "task", id: t.id })} onToggle={() => void toggle(t)} />
                ))}
              </ul>
            )}
          </section>
        )}

        <section className="mt-12" aria-labelledby="experiments-heading">
          <h2 id="experiments-heading" className="text-[length:var(--fs-xl)] font-semibold">
            Experiments
          </h2>
          <ul className="mt-2">
            {work.experiments.length === 0 && <li className="px-3 py-2 text-sm text-muted">None yet. An experiment tests one assumption.</li>}
            {work.experiments.map((e) => (
              <li key={e.id}>
                <button onClick={() => setOpen({ type: "experiment", id: e.id })} className="flex w-full flex-col items-start rounded-md px-3 py-2 text-left transition-colors duration-[var(--dur-fast)] hover:bg-surface-2">
                  <span className="text-[length:var(--fs-base)]">{e.hypothesis}</span>
                  <span className="text-xs text-muted">
                    {e.status}
                    {e.assumptionTitle ? ` · tests “${e.assumptionTitle}”` : ""}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <form
            className="mt-3 flex gap-2"
            onSubmit={(ev) => {
              ev.preventDefault();
              if (!exp.hypothesis.trim()) return;
              void act(() => api("POST", "/api/experiments", { hypothesis: exp.hypothesis, assumptionId: exp.assumptionId || null })).then(() => setExp({ hypothesis: "", assumptionId: "" }));
            }}
          >
            <Input aria-label="New experiment hypothesis" placeholder="Hypothesis, e.g. 7 of 10 students mention it unprompted" value={exp.hypothesis} maxLength={400} onChange={(e) => setExp({ ...exp, hypothesis: e.target.value })} />
            <select aria-label="Assumption to test" value={exp.assumptionId} onChange={(e) => setExp({ ...exp, assumptionId: e.target.value })} className="h-9 max-w-[11rem] rounded-md border border-line bg-surface px-2 text-sm">
              <option value="">No assumption</option>
              {work.assumptions.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.title.slice(0, 40)}
                </option>
              ))}
            </select>
          </form>
        </section>
      </div>

      <ContextPanel open={open !== null} onClose={() => setOpen(null)} title={open?.type === "experiment" ? "Experiment" : "Task"}>
        {openTask && <TaskPanel key={openTask.id} task={openTask} others={tasks} onChanged={() => void reload()} onDeleted={() => setOpen(null)} />}
        {openExp && <ExperimentPanel key={`${openExp.id}-${openExp.status}`} experiment={openExp} onChanged={() => void reload()} />}
      </ContextPanel>
    </div>
  );
}
