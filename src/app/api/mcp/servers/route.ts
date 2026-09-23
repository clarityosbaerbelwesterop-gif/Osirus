import { z } from "zod";
import { connectorKeyConfigured } from "@/lib/connectors/crypto";
import {
  addMcpServer,
  checkMcpServer,
  listMcpServers,
} from "@/lib/connectors/mcp-store";
import { apiIdentity, guardWrite, json } from "@/lib/product/api";
import { OutboundBlockedError } from "@/lib/security/outbound";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const identity = await apiIdentity();
  if (!identity) return json({ error: "unauthorized" }, 401);
  return json({ servers: await listMcpServers(identity) });
}

const addSchema = z.object({
  name: z.string().trim().min(1).max(80),
  url: z.string().trim().min(9).max(500),
  token: z.string().trim().min(8).max(2000).nullable().optional(),
});

/** Add a server, then test it and discover its tools right away. */
export async function POST(request: Request) {
  const guard = await guardWrite(request, {
    schema: addSchema,
    route: "mcp.add",
    limit: 10,
    maxBytes: 8 * 1024,
  });
  if (!guard.ok) return guard.response;
  if (guard.body.token && !connectorKeyConfigured())
    return json({ error: "connector_key_not_configured" }, 503);
  let id: string;
  try {
    id = await addMcpServer(guard.identity, {
      name: guard.body.name,
      url: guard.body.url,
      token: guard.body.token ?? null,
    });
  } catch (error) {
    if (error instanceof OutboundBlockedError)
      return json({ error: error.reason }, 400);
    if (error instanceof Error && /duplicate key|unique/i.test(error.message))
      return json({ error: "duplicate_name" }, 409);
    throw error;
  }
  const result = await checkMcpServer(guard.identity, id);
  return json({ id, result });
}
