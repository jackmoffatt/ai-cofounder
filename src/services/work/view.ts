import type { Db } from "@/db/client";
import { getItem, listItems } from "@/db/queries/memory";
import { listExperimentRows, listObjectiveRows } from "@/db/queries/work";
import type { Experiment, Objective } from "@/db/schema";
import { todayLocal } from "@/lib/work";
import { listTaskViews, type TaskView } from "./tasks";

export interface ExperimentView extends Experiment {
  assumptionTitle: string | null;
}

export interface WorkOverview {
  today: string;
  objective: Objective | null;
  objectives: Objective[];
  experiments: ExperimentView[];
  tasks: TaskView[];
  /** Assumptions an experiment can test, for the picker. */
  assumptions: Array<{ id: string; title: string }>;
}

export function workOverview(db: Db, today = todayLocal()): WorkOverview {
  const objectives = listObjectiveRows(db);
  return {
    today,
    objective: objectives.find((o) => o.status === "active") ?? null,
    objectives,
    experiments: listExperimentRows(db).map((e) => ({ ...e, assumptionTitle: e.assumptionId ? (getItem(db, e.assumptionId)?.title ?? null) : null })),
    tasks: listTaskViews(db, today),
    assumptions: listItems(db, { kind: "assumption" })
      .filter((i) => i.status !== "rejected")
      .map((i) => ({ id: i.id, title: i.title })),
  };
}
