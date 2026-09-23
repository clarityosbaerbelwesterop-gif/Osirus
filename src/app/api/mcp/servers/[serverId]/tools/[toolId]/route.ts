import { z } from "zod";
import { setMcpToolEnabled } from "@/lib/connectors/mcp-store";
import { guardWrite, json } from "@/lib/product/api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const params = z.object({
  serverId: z.string().uuid(),
  toolId: z.string().uuid(),
});
const patchSchema = z.object({ enabled: z.boolean() });

/** Allow or stop one reviewed tool. Allowing records the reviewer. */
export async function PATCH(
  request: Request,
  context: { params: Promise<{ serverId: string; toolId: string }> },
) {
  const parsed = params.safeParse(await context.params);
  if (!parsed.success) return json({ error: "invalid_id" }, 400);
  const guard = await guardWrite(request, {
    schema: patchSchema,
    route: "mcp.tool",
    limit: 120,
    maxBytes: 1024,
  });
  if (!guard.ok) return guard.response;
  const updated = await setMcpToolEnabled(guard.identity, {
    serverId: parsed.data.serverId,
    toolId: parsed.data.toolId,
    enabled: guard.body.enabled,
  });
  return updated ? json({ ok: true }) : json({ error: "not_found" }, 404);
}
