import { z } from "zod";
import {
  removeMcpServer,
  setMcpServerEnabled,
} from "@/lib/connectors/mcp-store";
import { guardAction, guardWrite, json } from "@/lib/product/api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const params = z.object({ serverId: z.string().uuid() });
const patchSchema = z.object({ enabled: z.boolean() });

export async function PATCH(
  request: Request,
  context: { params: Promise<{ serverId: string }> },
) {
  const parsed = params.safeParse(await context.params);
  if (!parsed.success) return json({ error: "invalid_id" }, 400);
  const guard = await guardWrite(request, {
    schema: patchSchema,
    route: "mcp.update",
    limit: 60,
    maxBytes: 1024,
  });
  if (!guard.ok) return guard.response;
  const updated = await setMcpServerEnabled(
    guard.identity,
    parsed.data.serverId,
    guard.body.enabled,
  );
  return updated ? json({ ok: true }) : json({ error: "not_found" }, 404);
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ serverId: string }> },
) {
  const parsed = params.safeParse(await context.params);
  if (!parsed.success) return json({ error: "invalid_id" }, 400);
  const guard = await guardAction(request, { route: "mcp.remove", limit: 20 });
  if (!guard.ok) return guard.response;
  const removed = await removeMcpServer(guard.identity, parsed.data.serverId);
  return removed ? json({ ok: true }) : json({ error: "not_found" }, 404);
}
