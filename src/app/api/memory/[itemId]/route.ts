import { z } from "zod";
import { guardAction, json } from "@/lib/product/api";
import { forgetMemoryItem } from "@/lib/product/settings";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const params = z.object({ itemId: z.string().uuid() });

/** Forget one memory item. Row-level security limits this to its owner. */
export async function DELETE(
  request: Request,
  context: { params: Promise<{ itemId: string }> },
) {
  const parsed = params.safeParse(await context.params);
  if (!parsed.success) return json({ error: "invalid_id" }, 400);
  const guard = await guardAction(request, {
    route: "memory.forget",
    limit: 60,
  });
  if (!guard.ok) return guard.response;
  const removed = await forgetMemoryItem(guard.identity, parsed.data.itemId);
  return removed ? json({ ok: true }) : json({ error: "not_found" }, 404);
}
