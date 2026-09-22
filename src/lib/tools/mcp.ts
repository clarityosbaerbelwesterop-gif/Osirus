import { z } from "zod";
import type { ArmId } from "../arms/types";
import type { ToolDefinition } from "./registry";

// MCP servers.
//
// Discovery is dynamic on purpose: the set of servers a workspace connects to
// is theirs to decide, and hardcoding a list of known ones would mean this
// file needs editing every time that changes.
//
// Everything a server says about itself is a claim, not a fact. A server names
// its tools, writes their descriptions and declares what they do -- and an
// attacker who controls a server controls all three. So:
//
//   * Discovered tools are namespaced, and can never shadow a builtin.
//   * A server does not get to declare its own risk. Every discovered tool is
//     external and high risk, which means every call goes through the approval
//     gate. A server cannot opt out by describing itself as harmless.
//   * Descriptions are treated as untrusted text: capped, stripped of control
//     characters, and labelled where they are shown.
//   * Results are ordinary tool results, so asPromptContext() applies.

export const MCP_NAMESPACE = "mcp";

const toolSchema = z.object({
  name: z.string().min(1).max(128),
  description: z.string().max(4000).optional(),
  inputSchema: z.unknown().optional(),
});

const listResponseSchema = z.object({
  tools: z.array(toolSchema).max(256),
});

export type McpServer = {
  /** Stable identifier within the workspace; used in the namespaced tool id. */
  id: string;
  url: string;
  /** Sent as a bearer token. Never logged and never shown to a model. */
  token?: string;
};

export type DiscoveredTool = {
  id: string;
  serverId: string;
  remoteName: string;
  description: string;
};

/**
 * Strip anything that lets a description escape the context it is rendered in.
 *
 * Control characters, prompt-injection fences and sheer length are all ways a
 * description tries to stop being a description.
 */
export function sanitizeDescription(raw: string | undefined): string {
  if (!raw) return "No description supplied by the server.";
  return raw
    .replaceAll(/[\u0000-\u0008\u000b-\u001f\u007f]/g, " ")
    .replaceAll(/-{5,}/g, "---")
    .replaceAll(/```/g, "'''")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 400);
}

export function namespacedId(serverId: string, remoteName: string) {
  const safeServer = serverId.replaceAll(/[^a-zA-Z0-9_-]/g, "").slice(0, 48);
  const safeName = remoteName.replaceAll(/[^a-zA-Z0-9_.-]/g, "").slice(0, 64);
  return `${MCP_NAMESPACE}:${safeServer}/${safeName}`;
}

export type McpTransport = (input: {
  server: McpServer;
  method: string;
  params: Record<string, unknown>;
  signal?: AbortSignal;
}) => Promise<unknown>;

/**
 * The default transport: JSON-RPC over HTTP.
 *
 * Kept injectable so discovery and the trust rules above are testable without
 * a network, which matters because the environments this is developed in do
 * not have one.
 */
export const httpTransport: McpTransport = async ({
  server,
  method,
  params,
  signal,
}) => {
  const response = await fetch(server.url, {
    method: "POST",
    signal,
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      ...(server.token ? { authorization: `Bearer ${server.token}` } : {}),
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: crypto.randomUUID(),
      method,
      params,
    }),
  });
  if (!response.ok) {
    throw new Error(`mcp_transport_failed:${response.status}`);
  }
  const payload = (await response.json()) as { result?: unknown };
  return payload.result;
};

export async function discoverTools(input: {
  server: McpServer;
  transport?: McpTransport;
  signal?: AbortSignal;
}): Promise<DiscoveredTool[]> {
  const transport = input.transport ?? httpTransport;
  const raw = await transport({
    server: input.server,
    method: "tools/list",
    params: {},
    signal: input.signal,
  });
  const parsed = listResponseSchema.safeParse(raw);
  if (!parsed.success) return [];

  const seen = new Set<string>();
  const tools: DiscoveredTool[] = [];
  for (const tool of parsed.data.tools) {
    const id = namespacedId(input.server.id, tool.name);
    if (seen.has(id)) continue;
    seen.add(id);
    tools.push({
      id,
      serverId: input.server.id,
      remoteName: tool.name,
      description: sanitizeDescription(tool.description),
    });
  }
  return tools;
}

/**
 * Wrap a discovered tool as a registry definition.
 *
 * The input schema is deliberately a permissive record rather than whatever
 * the server advertised: validating against a schema the server wrote proves
 * only that the server agrees with itself. The approval gate is what actually
 * stands between the call and the outside world.
 */
export function toolFromDiscovery(input: {
  tool: DiscoveredTool;
  server: McpServer;
  arms: ArmId[];
  transport?: McpTransport;
}): ToolDefinition<Record<string, unknown>, unknown> {
  const transport = input.transport ?? httpTransport;
  return {
    id: input.tool.id,
    title: `${input.tool.serverId}: ${input.tool.remoteName}`,
    summary: input.tool.description,
    trust: "mcp",
    // Not negotiable by the server. Both values force the approval gate.
    effect: "external",
    risk: "high",
    arms: input.arms,
    inputSchema: z.record(z.string(), z.unknown()),
    run: (args, context) =>
      transport({
        server: input.server,
        method: "tools/call",
        params: { name: input.tool.remoteName, arguments: args },
        signal: context.signal,
      }),
  };
}
