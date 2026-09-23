import { z } from "zod";
import { checkMcpServer } from "@/lib/connectors/mcp-store";
import { guardAction, json } from "@/lib/product/api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const params = z.object({ serverId: z.string().uuid() });

/** Test the server and refresh its tool list. */
export async function POST(
  request: Request,
  context: { params: Promise<{ serverId: string }> },
) {
  const parsed = params.safeParse(await context.params);
  if (!parsed.success) return json({ error: "invalid_id" }, 400);
  const guard = await guardAction(request, { route: "mcp.check", limit: 12 });
  if (!guard.ok) return guard.response;
  const result = await checkMcpServer(guard.identity, parsed.data.serverId);
  if (!result) return json({ error: "not_found" }, 404);
  return json({ result });
}
