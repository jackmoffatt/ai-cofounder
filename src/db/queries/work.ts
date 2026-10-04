import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import type { Db } from "../client";
import {
  LOCAL_OWNER,
  experiments,
  objectives,
  taskDeps,
  tasks,
  type Experiment,
  type Objective,
  type Task,
} from "../schema";

export const insertTaskRow = (db: Db, row: Task) => void db.insert(tasks).values(row).run();
export const getTaskRow = (db: Db, id: string): Task | undefined =>
  db.select().from(tasks).where(and(eq(tasks.id, id), eq(tasks.ownerId, LOCAL_OWNER))).get();
export const updateTaskRow = (db: Db, id: string, patch: Partial<Task>) => void db.update(tasks).set(patch).where(eq(tasks.id, id)).run();

export function listTaskRows(db: Db, opts: { includeDeleted?: boolean } = {}): Task[] {
  return db
    .select()
    .from(tasks)
    .where(opts.includeDeleted ? eq(tasks.ownerId, LOCAL_OWNER) : and(eq(tasks.ownerId, LOCAL_OWNER), isNull(tasks.deletedAt)))
    .orderBy(desc(tasks.createdAt))
    .all();
}

export const listAllDeps = (db: Db) => db.select().from(taskDeps).all();
export const listDepsOf = (db: Db, taskId: string): string[] =>
  db.select().from(taskDeps).where(eq(taskDeps.taskId, taskId)).all().map((d) => d.dependsOnId);
export const replaceDeps = (db: Db, taskId: string, dependsOn: string[]) => {
  db.delete(taskDeps).where(eq(taskDeps.taskId, taskId)).run();
  for (const id of dependsOn) db.insert(taskDeps).values({ taskId, dependsOnId: id }).run();
};
export const getTaskRows = (db: Db, ids: string[]): Task[] => (ids.length ? db.select().from(tasks).where(inArray(tasks.id, ids)).all() : []);

export const insertObjectiveRow = (db: Db, row: Objective) => void db.insert(objectives).values(row).run();
export const getObjectiveRow = (db: Db, id: string): Objective | undefined => db.select().from(objectives).where(eq(objectives.id, id)).get();
export const updateObjectiveRow = (db: Db, id: string, patch: Partial<Objective>) => void db.update(objectives).set(patch).where(eq(objectives.id, id)).run();
export const listObjectiveRows = (db: Db): Objective[] =>
  db.select().from(objectives).where(eq(objectives.ownerId, LOCAL_OWNER)).orderBy(desc(objectives.createdAt)).all();

export const insertExperimentRow = (db: Db, row: Experiment) => void db.insert(experiments).values(row).run();
export const getExperimentRow = (db: Db, id: string): Experiment | undefined => db.select().from(experiments).where(eq(experiments.id, id)).get();
export const updateExperimentRow = (db: Db, id: string, patch: Partial<Experiment>) => void db.update(experiments).set(patch).where(eq(experiments.id, id)).run();
export const listExperimentRows = (db: Db): Experiment[] =>
  db.select().from(experiments).where(eq(experiments.ownerId, LOCAL_OWNER)).orderBy(desc(experiments.createdAt)).all();
