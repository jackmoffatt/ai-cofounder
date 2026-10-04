export const TASK_STATUSES = ["todo", "doing", "blocked", "done", "dropped"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
export const TASK_CATEGORIES = ["research", "interview", "build", "outreach", "admin", "other"] as const;
export type TaskCategory = (typeof TASK_CATEGORIES)[number];
export const PRIORITIES = ["high", "medium", "low"] as const;
export type Priority = (typeof PRIORITIES)[number];
export const EXPERIMENT_STATUSES = ["planned", "running", "completed", "abandoned"] as const;
export type ExperimentStatus = (typeof EXPERIMENT_STATUSES)[number];
export const OBJECTIVE_STATUSES = ["active", "achieved", "dropped"] as const;

/** Today's date in the server's local calendar, as YYYY-MM-DD. */
export function todayLocal(now = new Date()): string {
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${m}-${d}`;
}

export function isValidDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export const isOpen = (status: string) => status !== "done" && status !== "dropped";

const PRIORITY_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 };

/** Most important first: priority, then soonest due date (undated last), then oldest. */
export function compareTasks(
  a: { priority: string; dueDate: string | null; createdAt: string },
  b: { priority: string; dueDate: string | null; createdAt: string },
): number {
  return (
    (PRIORITY_RANK[a.priority] ?? 1) - (PRIORITY_RANK[b.priority] ?? 1) ||
    (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999") ||
    a.createdAt.localeCompare(b.createdAt)
  );
}

/** A task with unfinished dependencies is blocked no matter what status was set. */
export function effectiveStatus(status: string, openDependencies: number): string {
  return (status === "todo" || status === "doing") && openDependencies > 0 ? "blocked" : status;
}
