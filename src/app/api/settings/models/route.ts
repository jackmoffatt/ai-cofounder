import { z } from "zod";
import { getDb } from "@/db/client";
import { rejectCrossOrigin } from "@/lib/security";
import { MODEL_ROLES } from "@/services/ai/models";
import { healthReport } from "@/services/health";
import { SettingsError, saveModelOverride } from "@/services/settings";

export const dynamic = "force-dynamic";

const Body = z.object({ role: z.enum(MODEL_ROLES), model: z.string().max(100).nullable() });

/** Choose the model for one role, or pass null to go back to the default. */
export async function PATCH(req: Request) {
  const blocked = rejectCrossOrigin(req);
  if (blocked) return blocked;
  const body = Body.safeParse(await req.json().catch(() => null));
  if (!body.success) return Response.json({ error: "Invalid request" }, { status: 400 });
  const db = getDb();
  try {
    saveModelOverride(db, body.data.role, body.data.model);
  } catch (e) {
    if (e instanceof SettingsError) return Response.json({ error: e.message }, { status: 400 });
    throw e;
  }
  return Response.json(healthReport(db));
}
