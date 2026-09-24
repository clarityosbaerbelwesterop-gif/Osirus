import { z } from "zod";
import { deleteAttachment } from "@/lib/attachments/store";
import { guardAction, json } from "@/lib/product/api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ attachmentId: string }> },
) {
  const guard = await guardAction(request, {
    route: "attachments.delete",
    limit: 30,
  });
  if (!guard.ok) return guard.response;
  const id = z
    .string()
    .uuid()
    .safeParse((await params).attachmentId).data;
  if (!id) return json({ error: "not_found" }, 404);
  return (await deleteAttachment(guard.identity, id))
    ? json({ deleted: true })
    : json({ error: "not_found" }, 404);
}
