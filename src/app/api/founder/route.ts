import { z } from "zod";
import { getDb } from "@/db/client";
import { FounderProfileSchema } from "@/lib/profile";
import { rejectCrossOrigin } from "@/lib/security";
import { readFounder, saveFounderEdit } from "@/services/memory/founder";

export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(readFounder(getDb()));
}

const Patch = z.object({
  name: z.string().trim().max(80).nullable().optional(),
  profile: FounderProfileSchema.optional(),
});

export async function PATCH(req: Request) {
  const blocked = rejectCrossOrigin(req);
  if (blocked) return blocked;
  const body = Patch.safeParse(await req.json().catch(() => null));
  if (!body.success) return Response.json({ error: "Invalid request" }, { status: 400 });
  const db = getDb();
  saveFounderEdit(db, body.data);
  return Response.json(readFounder(db));
}
