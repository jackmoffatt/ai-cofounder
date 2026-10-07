import { notFound } from "next/navigation";
import { z } from "zod";
import { getDb } from "@/db/client";
import { getConversation } from "@/db/queries/conversations";

export const dynamic = "force-dynamic";

/** `/` and `/c/<id>` are the chat workspace, which lives in the app shell (see WorkspaceProvider) so its
 *  tabs persist across navigation. This route only answers 404 for a conversation that doesn't exist. */
export default async function Page({ params }: { params: Promise<{ slug?: string[] }> }) {
  const { slug } = await params;
  if (!slug) return null;
  const id = slug.length === 2 && slug[0] === "c" ? z.uuid().safeParse(slug[1]) : null;
  if (!id?.success || !getConversation(getDb(), id.data)) notFound();
  return null;
}
