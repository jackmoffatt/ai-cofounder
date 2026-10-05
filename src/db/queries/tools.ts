import { eq } from "drizzle-orm";
import type { Db } from "../client";
import { approvals, type Approval } from "../schema";

export function insertApproval(db: Db, row: { tool: string; args: string; summary: string }): Approval {
  const full: Approval = { id: crypto.randomUUID(), ...row, status: "pending", requestedAt: new Date().toISOString(), decidedAt: null };
  db.insert(approvals).values(full).run();
  return full;
}

export const getApproval = (db: Db, id: string): Approval | undefined => db.select().from(approvals).where(eq(approvals.id, id)).get();
export const listApprovals = (db: Db): Approval[] => db.select().from(approvals).all();
