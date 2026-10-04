import type { Db } from "@/db/client";
import { getItem } from "@/db/queries/memory";
import { PRIORITIES, TASK_CATEGORIES, addDays, todayLocal, type Priority, type TaskCategory } from "@/lib/work";
import { createItem } from "@/services/memory/items";
import { readActiveStartup } from "@/services/memory/startup";
import { createExperiment } from "./experiments";
import { createObjective } from "./objectives";
import { createTask, setDependencies } from "./tasks";

/**
 * A validation plan, as the agent proposes it and the founder accepts it: one objective, the
 * assumptions it tests, experiments for them, and the tasks that carry the experiments out.
 * Cross-references are indexes into the arrays below, resolved to ids on accept.
 */
export interface PlanChange {
  type: "plan";
  objective: { title: string; description: string; successCriteria: string };
  /** Existing assumption (`itemId`) or a new one to record (`itemId` null). */
  assumptions: Array<{ itemId: string | null; title: string }>;
  experiments: Array<{ assumption: number; hypothesis: string; method: string; successCriteria: string }>;
  tasks: Array<{
    title: string;
    description: string;
    category: TaskCategory;
    priority: Priority;
    /** Index into `experiments`, or null. */
    experiment: number | null;
    /** Indexes into `tasks` that must finish first. */
    dependsOn: number[];
    dueInDays: number | null;
  }>;
}

export const MAX_PLAN_ASSUMPTIONS = 6;
export const MAX_PLAN_EXPERIMENTS = 6;
export const MAX_PLAN_TASKS = 12;

/** Why a plan can't be used, or null. Checked when proposed and again on accept. */
export function validatePlan(db: Db, p: PlanChange): string | null {
  if (!p.objective.title.trim()) return "No objective";
  if (p.tasks.length === 0 && p.experiments.length === 0) return "Nothing to do";
  if (p.assumptions.length > MAX_PLAN_ASSUMPTIONS || p.experiments.length > MAX_PLAN_EXPERIMENTS || p.tasks.length > MAX_PLAN_TASKS) return "Too large";
  if (p.assumptions.some((a) => !a.title.trim())) return "Empty assumption";
  if (p.experiments.some((e) => !Number.isInteger(e.assumption) || e.assumption < 0 || e.assumption >= p.assumptions.length || !e.hypothesis.trim())) {
    return "Bad experiment";
  }
  for (const [i, t] of p.tasks.entries()) {
    if (!t.title.trim()) return "Empty task";
    if (!TASK_CATEGORIES.includes(t.category) || !PRIORITIES.includes(t.priority)) return "Bad task";
    if (t.experiment !== null && (!Number.isInteger(t.experiment) || t.experiment < 0 || t.experiment >= p.experiments.length)) return "Bad task link";
    if (t.dependsOn.some((d) => !Number.isInteger(d) || d < 0 || d >= p.tasks.length || d === i)) return "Bad dependency";
  }
  // No dependency loops (depth-first with colouring).
  const state = new Map<number, 1 | 2>();
  const cyclic = (i: number): boolean => {
    if (state.get(i) === 2) return false;
    if (state.get(i) === 1) return true;
    state.set(i, 1);
    const loop = p.tasks[i].dependsOn.some(cyclic);
    state.set(i, 2);
    return loop;
  };
  if (p.tasks.some((_, i) => cyclic(i))) return "Dependency loop";
  return null;
}

export function describePlan(p: PlanChange): string {
  const bits = [`${p.experiments.length} experiment${p.experiments.length === 1 ? "" : "s"}`, `${p.tasks.length} task${p.tasks.length === 1 ? "" : "s"}`];
  return `Plan: ${p.objective.title} · ${bits.join(" · ")}`;
}

/**
 * Creates everything in the plan atomically: if any step fails nothing is saved.
 * New assumptions start untested like any other; the plan never validates anything.
 */
export function applyPlan(db: Db, p: PlanChange, origin: { proposalId: string }, today = todayLocal()): void {
  const startup = readActiveStartup(db);
  db.transaction((tx) => {
    const t = tx as unknown as Db;
    const objective = createObjective(t, {
      title: p.objective.title,
      description: p.objective.description,
      successCriteria: p.objective.successCriteria,
      createdBy: "agent",
      reason: "Accepted plan",
    });

    const assumptionIds = p.assumptions.map((a) => {
      const existing = a.itemId ? getItem(t, a.itemId) : undefined;
      if (existing && !existing.deletedAt) return existing.id;
      return createItem(t, {
        kind: "assumption",
        title: a.title,
        importance: 4,
        origin: "conversation",
        originRef: origin,
        createdBy: "agent",
        startupId: startup?.id ?? null,
        reason: "Part of an accepted validation plan",
      }).item.id;
    });

    const experimentIds = p.experiments.map(
      (e) =>
        createExperiment(t, {
          hypothesis: e.hypothesis,
          method: e.method,
          successCriteria: e.successCriteria,
          assumptionId: assumptionIds[e.assumption],
          objectiveId: objective.id,
          createdBy: "agent",
          reason: "Accepted plan",
        }).id,
    );

    const taskIds: string[] = [];
    for (const task of p.tasks) {
      taskIds.push(
        createTask(t, {
          title: task.title,
          description: task.description,
          category: task.category,
          priority: task.priority,
          dueDate: task.dueInDays !== null && task.dueInDays >= 0 ? addDays(today, Math.min(task.dueInDays, 365)) : null,
          objectiveId: objective.id,
          experimentId: task.experiment !== null ? experimentIds[task.experiment] : null,
          startupId: startup?.id ?? null,
          origin: "plan",
          originRef: origin,
          createdBy: "agent",
          reason: "Accepted plan",
        }).task.id,
      );
    }
    // Dependencies after all tasks exist, so order in the plan doesn't matter.
    // (setDependencies validates there are no loops against what is stored.)
    p.tasks.forEach((task, i) => {
      if (task.dependsOn.length) setDependencies(t, taskIds[i], task.dependsOn.map((d) => taskIds[d]));
    });
  });
}
