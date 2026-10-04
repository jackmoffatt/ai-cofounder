"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { EditableField } from "@/components/ui/EditableField";
import { PRIORITIES, TASK_CATEGORIES, TASK_STATUSES, isOpen } from "@/lib/work";
import { api, notifyMemoryChanged } from "@/lib/memoryClient";
import type { TaskView } from "@/services/work/tasks";

const selectClass = "mt-1 block h-8 w-full rounded-md border border-line bg-surface px-2 text-sm focus:border-accent focus:outline-none";

/** Edit one task: what, how important, when, and what it waits on. Saves as you change things. */
export function TaskPanel({ task, others, onChanged, onDeleted }: { task: TaskView; others: TaskView[]; onChanged: () => void; onDeleted: () => void }) {
  const [error, setError] = useState<string | null>(null);

  async function patch(p: object) {
    setError(null);
    try {
      await api("PATCH", `/api/tasks/${task.id}`, p);
      onChanged();
      notifyMemoryChanged();
    } catch (e) {
      setError(e instanceof Error && e.message.length > 3 ? e.message : "Couldn't save. Try again.");
    }
  }

  const candidates = others.filter((t) => t.id !== task.id && isOpen(t.status));

  return (
    <div className="space-y-5">
      <EditableField label="Task" value={task.title} rows={2} onSave={(v) => patch({ title: v })} />
      <EditableField label="Details" value={task.description} rows={3} onSave={(v) => patch({ description: v })} />

      <div className="grid grid-cols-2 gap-3">
        <label className="text-xs text-muted">
          Status
          <select className={selectClass} value={task.status} onChange={(e) => void patch({ status: e.target.value })}>
            {TASK_STATUSES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
        <label className="text-xs text-muted">
          Priority
          <select className={selectClass} value={task.priority} onChange={(e) => void patch({ priority: e.target.value })}>
            {PRIORITIES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
        <label className="text-xs text-muted">
          Category
          <select className={selectClass} value={task.category} onChange={(e) => void patch({ category: e.target.value })}>
            {TASK_CATEGORIES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
        <label className="text-xs text-muted">
          Due
          <input
            type="date"
            className={selectClass}
            value={task.dueDate ?? ""}
            onChange={(e) => void patch({ dueDate: e.target.value || null })}
          />
        </label>
      </div>

      <section aria-label="Dependencies">
        <h3 className="text-sm font-medium">Waits on</h3>
        {candidates.length === 0 ? (
          <p className="mt-1 text-sm text-muted">No other open tasks.</p>
        ) : (
          <ul className="mt-1 space-y-1">
            {candidates.map((c) => (
              <li key={c.id}>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={task.dependsOn.includes(c.id)}
                    onChange={(e) =>
                      void patch({ dependsOn: e.target.checked ? [...task.dependsOn, c.id] : task.dependsOn.filter((d) => d !== c.id) })
                    }
                  />
                  {c.title}
                </label>
              </li>
            ))}
          </ul>
        )}
        {task.blockedBy.length > 0 && <p className="mt-1 text-xs text-muted">Blocked until: {task.blockedBy.map((b) => b.title).join(", ")}</p>}
      </section>

      <p className="text-xs text-muted">
        {task.origin === "plan" ? "Created by an accepted plan." : task.origin === "conversation" ? "Saved from a conversation." : "Added by you."}
      </p>
      {error && (
        <p role="alert" className="text-sm text-muted">
          {error}
        </p>
      )}
      <Button
        variant="ghost"
        onClick={() => {
          if (!window.confirm("Delete this task?")) return;
          void api("DELETE", `/api/tasks/${task.id}`).then(() => {
            onChanged();
            onDeleted();
          });
        }}
      >
        Delete
      </Button>
    </div>
  );
}
