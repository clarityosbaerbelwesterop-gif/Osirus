import { z } from "zod";
import type { ArmId } from "../arms/types";
import { containsInjectionAttempt } from "../security/injection";
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
  /** Parameter names the server advertises, for review only. */
  parameters: string[];
  /** The raw description tried to address the model; shown as a warning. */
  flagged: boolean;
};

/** A description that tries to address the model rather than describe a tool. */
export function injectionSuspected(raw: string | undefined) {
  if (!raw) return false;
  return (
    raw.length > 400 ||
    /```|-{5,}/.test(raw) ||
    containsInjectionAttempt(raw) ||
    /you must|do not tell/i.test(raw)
  );
}

function parameterNames(schema: unknown) {
  if (typeof schema !== "object" || schema === null) return [];
  const properties = (schema as { properties?: unknown }).properties;
  if (typeof properties !== "object" || properties === null) return [];
  return Object.keys(properties)
    .map((key) => key.replaceAll(/[^a-zA-Z0-9_.-]/g, "").slice(0, 64))
    .filter(Boolean)
    .slice(0, 24);
}

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

const PROTOCOL_VERSION = "2025-06-18";

type RpcPayload = {
  id?: unknown;
  result?: unknown;
  error?: { code?: number; message?: string };
};

/** A JSON-RPC response from a JSON body or a server-sent event stream. */
export function parseRpcResponse(
  text: string,
  contentType: string,
  id: string,
) {
  let payload: RpcPayload | null = null;
  if (contentType.includes("text/event-stream")) {
    for (const block of text.split(/\r?\n\r?\n/)) {
      const data = block
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .join("\n");
      if (!data) continue;
      try {
        const candidate = JSON.parse(data) as RpcPayload;
        if (candidate.id === id) {
          payload = candidate;
          break;
        }
      } catch {
        continue;
      }
    }
  } else {
    try {
      payload = JSON.parse(text) as RpcPayload;
    } catch {
      payload = null;
    }
  }
  if (!payload) throw new Error("mcp_invalid_response");
  if (payload.error)
    throw new Error(`mcp_error:${Number(payload.error.code) || "unknown"}`);
  return payload.result;
}

async function rpc(input: {
  server: McpServer;
  method: string;
  params: Record<string, unknown>;
  signal?: AbortSignal;
  sessionId?: string | null;
  notification?: boolean;
}) {
  const { outboundFetch } = await import("../security/outbound");
  const id = crypto.randomUUID();
  const response = await outboundFetch(input.server.url, {
    method: "POST",
    signal: input.signal,
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": PROTOCOL_VERSION,
      ...(input.sessionId ? { "mcp-session-id": input.sessionId } : {}),
      ...(input.server.token
        ? { authorization: `Bearer ${input.server.token}` }
        : {}),
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      ...(input.notification ? {} : { id }),
      method: input.method,
      params: input.params,
    }),
  });
  if (response.status === 401 || response.status === 403)
    throw new Error(`mcp_unauthorized:${response.status}`);
  if (response.status < 200 || response.status >= 300)
    throw new Error(`mcp_transport_failed:${response.status}`);
  const sessionId = response.headers.get("mcp-session-id") ?? input.sessionId;
  if (input.notification) return { result: null, sessionId };
  return {
    result: parseRpcResponse(
      response.text,
      response.headers.get("content-type") ?? "",
      id,
    ),
    sessionId,
  };
}

export type McpServerInfo = {
  name: string | null;
  version: string | null;
  protocolVersion: string | null;
  sessionId: string | null;
};

function claim(value: unknown) {
  return typeof value === "string"
    ? sanitizeDescription(value).slice(0, 80)
    : null;
}

/**
 * Open a session: initialize, then the initialized notification. What the
 * server reports about itself is kept as an untrusted claim.
 */
export async function mcpInitialize(server: McpServer, signal?: AbortSignal) {
  const opened = await rpc({
    server,
    method: "initialize",
    params: {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "osirus", version: "1" },
    },
    signal,
  });
  const result = (opened.result ?? {}) as {
    protocolVersion?: unknown;
    serverInfo?: { name?: unknown; version?: unknown };
  };
  await rpc({
    server,
    method: "notifications/initialized",
    params: {},
    signal,
    sessionId: opened.sessionId,
    notification: true,
  }).catch(() => undefined);
  return {
    name: claim(result.serverInfo?.name),
    version: claim(result.serverInfo?.version),
    protocolVersion: claim(result.protocolVersion),
    sessionId: opened.sessionId ?? null,
  } satisfies McpServerInfo;
}

/**
 * The default transport: MCP over Streamable HTTP, one short session per
 * call. Every request goes through the outbound guard, so a server URL can
 * never reach a private or loopback address.
 */
export const httpTransport: McpTransport = async ({
  server,
  method,
  params,
  signal,
}) => {
  const session = await mcpInitialize(server, signal);
  const { result } = await rpc({
    server,
    method,
    params,
    signal,
    sessionId: session.sessionId,
  });
  return result;
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
      parameters: parameterNames(tool.inputSchema),
      flagged: injectionSuspected(tool.description),
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
