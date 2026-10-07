import { z } from "zod";
import { rejectCrossOrigin } from "@/lib/security";
import { AIError, getProvider, modelFor, userMessageFor } from "@/services/ai";
import { MODEL_ROLES } from "@/services/ai/models";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Models that take the `effort` setting; smaller ones reject it. */
const TAKES_EFFORT = new Set(["chat", "brief", "plan", "research"]);

/** Makes one tiny request with the model for a role, so a wrong key or model ID shows up here and not mid-conversation. */
export async function POST(req: Request) {
  const blocked = rejectCrossOrigin(req);
  if (blocked) return blocked;
  const body = z.object({ role: z.enum(MODEL_ROLES).default("chat") }).safeParse(await req.json().catch(() => ({})));
  if (!body.success) return Response.json({ error: "Invalid request" }, { status: 400 });

  const role = body.data.role;
  const model = modelFor(role);
  const started = Date.now();
  try {
    await getProvider().complete({
      model,
      system: "Reply with the single word OK.",
      messages: [{ role: "user", content: "ping" }],
      maxTokens: 1024,
      ...(TAKES_EFFORT.has(role) ? { effort: "low" as const } : {}),
    });
    return Response.json({ ok: true, model, ms: Date.now() - started });
  } catch (err) {
    const code = err instanceof AIError ? err.code : "unknown";
    return Response.json({ ok: false, model, message: userMessageFor(code) });
  }
}
