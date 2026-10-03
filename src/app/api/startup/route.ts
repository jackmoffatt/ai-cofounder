import { z } from "zod";
import { getDb } from "@/db/client";
import { STAGE_KEYS, StartupProfileSchema } from "@/lib/profile";
import { rejectCrossOrigin } from "@/lib/security";
import { establishStartup, readActiveStartup, saveStartupEdit } from "@/services/memory/startup";

export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({ startup: readActiveStartup(getDb()) });
}

/** Establish the active startup. V1 supports one, so a second create is a conflict. */
export async function POST(req: Request) {
  const blocked = rejectCrossOrigin(req);
  if (blocked) return blocked;
  const body = z
    .object({ name: z.string().trim().min(1).max(80) })
    .safeParse(await req.json().catch(() => null));
  if (!body.success) return Response.json({ error: "Invalid request" }, { status: 400 });
  const db = getDb();
  if (readActiveStartup(db)) return Response.json({ error: "A startup already exists" }, { status: 409 });
  return Response.json({ startup: establishStartup(db, body.data.name) }, { status: 201 });
}

const Patch = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  stage: z.enum(STAGE_KEYS).optional(),
  currentObjective: z.string().max(500).optional(),
  profile: StartupProfileSchema.optional(),
});

export async function PATCH(req: Request) {
  const blocked = rejectCrossOrigin(req);
  if (blocked) return blocked;
  const body = Patch.safeParse(await req.json().catch(() => null));
  if (!body.success) return Response.json({ error: "Invalid request" }, { status: 400 });
  const db = getDb();
  const current = readActiveStartup(db);
  if (!current) return Response.json({ error: "No startup" }, { status: 404 });
  return Response.json({ startup: saveStartupEdit(db, current.id, body.data) });
}
