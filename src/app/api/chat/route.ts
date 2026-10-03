import { z } from "zod";
import { runChatTurn } from "@/agent/chat";
import { getDb } from "@/db/client";
import { rejectCrossOrigin } from "@/lib/security";
import { getProvider } from "@/services/ai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  conversationId: z.uuid().optional(),
  message: z.string().trim().min(1).max(20_000).optional(),
});

export async function POST(req: Request) {
  const blocked = rejectCrossOrigin(req);
  if (blocked) return blocked;

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid request" }, { status: 400 });

  const encoder = new TextEncoder();
  const body = new ReadableStream({
    async start(controller) {
      // After the client disconnects, writes throw. Swallow that and keep draining the turn so the
      // reply produced so far is still saved to the conversation.
      const send = (event: unknown) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          /* client gone */
        }
      };
      try {
        for await (const event of runChatTurn(
          { db: getDb(), provider: getProvider() },
          { ...parsed.data, signal: req.signal },
        )) {
          send(event);
        }
      } catch (err) {
        console.error("chat turn failed:", err instanceof Error ? `${err.name}: ${err.message}` : "unknown");
        send({ type: "error", code: "unknown", message: "Something went wrong. Please try again." });
      } finally {
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
  });

  return new Response(body, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" },
  });
}
