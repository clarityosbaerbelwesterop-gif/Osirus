import { z } from "zod";
import { guardAction, json } from "@/lib/product/api";
import { deleteEndpoint } from "@/lib/webhooks/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ endpointId: string }> },
) {
  const guard = await guardAction(request, {
    route: "webhooks.delete",
    limit: 20,
  });
  if (!guard.ok) return guard.response;
  const id = z
    .string()
    .uuid()
    .safeParse((await params).endpointId).data;
  if (!id) return json({ error: "not_found" }, 404);
  return (await deleteEndpoint(guard.identity, id).catch(() => false))
    ? json({ deleted: true })
    : json({ error: "not_found" }, 404);
}
