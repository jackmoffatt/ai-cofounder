import { MemoryError } from "@/services/memory/items";
import { WorkError } from "@/services/work/tasks";

/** Maps domain errors to HTTP responses; anything else is rethrown (and becomes a 500 without details). */
export function domainErrorResponse(e: unknown): Response {
  if (e instanceof WorkError || e instanceof MemoryError) {
    return Response.json({ error: e.message }, { status: e.message === "Not found" ? 404 : 400 });
  }
  throw e;
}
