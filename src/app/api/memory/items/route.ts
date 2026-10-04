import { z } from "zod";
import { getDb } from "@/db/client";
import { ITEM_KINDS } from "@/lib/memory";
import { rejectCrossOrigin } from "@/lib/security";
import { createItem } from "@/services/memory/items";
import { readActiveStartup } from "@/services/memory/startup";
import { getItemDetail, listItemViews } from "@/services/memory/view";

export const dynamic = "force-dynamic";

export function GET(req: Request) {
  const kind = z.enum(ITEM_KINDS).safeParse(new URL(req.url).searchParams.get("kind") ?? undefined);
  return Response.json({ items: listItemViews(getDb(), kind.success ? kind.data : undefined) });
}

const Create = z.object({
  kind: z.enum(ITEM_KINDS),
  title: z.string().trim().min(1).max(300),
  body: z.string().max(4000).optional(),
  importance: z.number().int().min(1).max(5).optional(),
  data: z.object({ reasoning: z.string().max(2000).optional() }).optional(),
});

export async function POST(req: Request) {
  const blocked = rejectCrossOrigin(req);
  if (blocked) return blocked;
  const body = Create.safeParse(await req.json().catch(() => null));
  if (!body.success) return Response.json({ error: "Invalid request" }, { status: 400 });
  const db = getDb();
  const { item } = createItem(db, {
    ...body.data,
    origin: "manual",
    createdBy: "user",
    startupId: readActiveStartup(db)?.id ?? null,
    reason: "Added by you",
  });
  return Response.json({ item: getItemDetail(db, item.id) }, { status: 201 });
}
