import "server-only";
import type { ArmId } from "../arms/types";
import type { ProductIdentity } from "../auth/bootstrap";
import { queryAs } from "../db/client";
import { recordSecurityEvent } from "../security/events";
import { checkOutboundUrl, OutboundBlockedError } from "../security/outbound";
import {
  discoverTools,
  mcpInitialize,
  namespacedId,
  toolFromDiscovery,
  type McpServer,
} from "../tools/mcp";
import type { ToolDefinition } from "../tools/registry";
import { decryptSecret, encryptSecret } from "./crypto";
import { recordHealth } from "./health";
import type { McpServerView, McpToolView } from "./mcp-types";

// MCP servers a workspace connected, and the tools found on them.
//
// A server is added disabled-by-default at the tool level: discovery lists
// its tools, a person reviews each one and enables it explicitly. Every MCP
// tool is external and high risk (the table enforces it), so each call still
// needs an approval. If a server changes a tool's description after it was
// reviewed, the tool is switched off until someone reviews it again -- a
// server cannot quietly turn an approved tool into a different one.
//
// "Changes" means the whole definition: name, description and the full input
// schema, hashed into a fingerprint kept in input_schema (jsonb, so no schema
// migration). The fingerprint is re-checked on every health check and again
// right before every call; approvals are bound to it as well.

const ALL_ARMS: ArmId[] = [
  "general",
  "thinking",
  "coding",
  "research",
  "math_science",
  "building",
];

export type { McpServerView, McpToolView };

type ServerRow = {
  id: string;
  name: string;
  url: string;
  credential_reference: string | null;
  enabled: boolean;
  status: McpServerView["status"];
  server_name: string | null;
  server_version: string | null;
  last_checked_at: Date | string | null;
  last_ok_at: Date | string | null;
  last_latency_ms: number | null;
  last_error: string | null;
};

type ToolRow = {
  id: string;
  server_id: string;
  name: string;
  description: string;
  input_schema: {
    parameters?: string[];
    fingerprint?: string;
    flagged?: boolean;
  } | null;
  enabled: boolean;
  reviewed_at: Date | string | null;
};

/**
 * The URL as shown to people: query values masked, because MCP servers often
 * take an API key as a query parameter and the page must not echo it back.
 */
export function displayUrl(raw: string) {
  try {
    const url = new URL(raw);
    for (const key of [...new Set(url.searchParams.keys())])
      url.searchParams.set(key, "***");
    url.hash = "";
    return url.toString().replaceAll("%2A%2A%2A", "***");
  } catch {
    return "(invalid URL)";
  }
}

const iso = (value: Date | string | null) =>
  value ? new Date(value).toISOString() : null;

/** The stable, readable server id used inside namespaced tool ids. */
export function serverSlug(server: { id: string; name: string }) {
  const base = server.name
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-|-$/g, "")
    .slice(0, 32);
  return `${base || "server"}-${server.id.slice(0, 6)}`;
}

function publicError(error: unknown) {
  if (error instanceof OutboundBlockedError)
    return `Blocked: ${error.reason.replaceAll("_", " ")}`;
  const message = error instanceof Error ? error.message : String(error);
  if (message.startsWith("mcp_unauthorized"))
    return "The server rejected the credentials.";
  if (message.startsWith("mcp_transport_failed"))
    return `The server answered with HTTP ${message.split(":")[1]}.`;
  if (message.startsWith("mcp_error")) return "The server returned an error.";
  if (message === "mcp_invalid_response")
    return "The server's answer was not valid MCP.";
  if (/abort|timeout/i.test(message))
    return "The server did not answer in time.";
  return "The server could not be reached.";
}

export async function listMcpServers(
  identity: ProductIdentity,
): Promise<McpServerView[]> {
  const [servers, tools, calls] = await Promise.all([
    queryAs<ServerRow>(
      identity.userId,
      `select id, name, url, credential_reference, enabled, status, server_name,
              server_version, last_checked_at, last_ok_at, last_latency_ms,
              last_error
         from osirus.mcp_servers
        where workspace_id = $1::uuid
        order by created_at`,
      [identity.workspaceId],
    ),
    queryAs<ToolRow>(
      identity.userId,
      `select id, server_id, name, description, input_schema, enabled, reviewed_at
         from osirus.mcp_server_tools
        where workspace_id = $1::uuid
        order by name`,
      [identity.workspaceId],
    ),
    queryAs<{ prefix: string; at: Date | string }>(
      identity.userId,
      `select split_part(tool_name, '/', 1) as prefix, max(created_at) as at
         from osirus.tool_calls
        where workspace_id = $1::uuid
          and tool_name like 'mcp:%'
          and status = 'completed'
        group by 1`,
      [identity.workspaceId],
    ),
  ]);
  const lastCall = new Map(calls.map((row) => [row.prefix, iso(row.at)]));
  return servers.map((server) => {
    const own = tools.filter((tool) => tool.server_id === server.id);
    return {
      id: server.id,
      name: server.name,
      url: displayUrl(server.url),
      hasToken: Boolean(server.credential_reference),
      enabled: server.enabled,
      status: server.status,
      serverName: server.server_name,
      serverVersion: server.server_version,
      lastCheckedAt: iso(server.last_checked_at),
      lastOkAt: iso(server.last_ok_at),
      lastLatencyMs: server.last_latency_ms,
      lastError: server.last_error,
      toolCount: own.length,
      enabledToolCount: own.filter((tool) => tool.enabled).length,
      lastToolCallAt: lastCall.get(`mcp:${serverSlug(server)}`) ?? null,
      tools: own.map((tool) => ({
        id: tool.id,
        name: tool.name,
        description: tool.description,
        parameters: tool.input_schema?.parameters ?? [],
        enabled: tool.enabled,
        reviewedAt: iso(tool.reviewed_at),
        risk: "high" as const,
        ...(tool.input_schema?.flagged ? { flagged: true } : {}),
      })),
    };
  });
}

export async function addMcpServer(
  identity: ProductIdentity,
  input: { name: string; url: string; token?: string | null },
) {
  const url = checkOutboundUrl(input.url).toString();
  const sealed = input.token ? encryptSecret(input.token) : null;
  const rows = await queryAs<{ id: string }>(
    identity.userId,
    `insert into osirus.mcp_servers
       (organization_id, workspace_id, name, url, credential_reference, created_by)
     values ($1::uuid, $2::uuid, $3, $4, $5, $6::uuid)
     returning id`,
    [
      identity.organizationId,
      identity.workspaceId,
      input.name.trim(),
      url,
      sealed,
      identity.userId,
    ],
  );
  return rows[0]!.id;
}

export async function removeMcpServer(identity: ProductIdentity, id: string) {
  const rows = await queryAs<{ id: string }>(
    identity.userId,
    `delete from osirus.mcp_servers
      where id = $1::uuid and workspace_id = $2::uuid
      returning id`,
    [id, identity.workspaceId],
  );
  return rows.length > 0;
}

export async function setMcpServerEnabled(
  identity: ProductIdentity,
  id: string,
  enabled: boolean,
) {
  const rows = await queryAs<{ id: string }>(
    identity.userId,
    `update osirus.mcp_servers set enabled = $3, updated_at = now()
      where id = $1::uuid and workspace_id = $2::uuid
      returning id`,
    [id, identity.workspaceId, enabled],
  );
  return rows.length > 0;
}

/**
 * Enable or disable one tool. Enabling records who reviewed it and when; the
 * database refuses an enabled tool without a review.
 */
export async function setMcpToolEnabled(
  identity: ProductIdentity,
  input: { serverId: string; toolId: string; enabled: boolean },
) {
  const rows = await queryAs<{ id: string }>(
    identity.userId,
    `update osirus.mcp_server_tools
        set enabled = $4,
            reviewed_by = case when $4 then $5::uuid else reviewed_by end,
            reviewed_at = case when $4 then now() else reviewed_at end
      where id = $1::uuid and server_id = $2::uuid and workspace_id = $3::uuid
      returning id`,
    [
      input.toolId,
      input.serverId,
      identity.workspaceId,
      input.enabled,
      identity.userId,
    ],
  );
  return rows.length > 0;
}

async function loadServer(identity: ProductIdentity, id: string) {
  const rows = await queryAs<ServerRow>(
    identity.userId,
    `select id, name, url, credential_reference, enabled, status, server_name,
            server_version, last_checked_at, last_ok_at, last_latency_ms,
            last_error
       from osirus.mcp_servers
      where id = $1::uuid and workspace_id = $2::uuid`,
    [id, identity.workspaceId],
  );
  return rows[0] ?? null;
}

function toServer(row: ServerRow): McpServer {
  return {
    id: serverSlug(row),
    url: row.url,
    token: row.credential_reference
      ? decryptSecret(row.credential_reference)
      : undefined,
  };
}

/**
 * Test the connection and refresh the tool list. Records health either way.
 * Returns what changed so the person can see it.
 */
export async function checkMcpServer(identity: ProductIdentity, id: string) {
  const row = await loadServer(identity, id);
  if (!row) return null;
  const server = toServer(row);
  const started = Date.now();
  try {
    const info = await mcpInitialize(server);
    const tools = await discoverTools({ server });
    const latency = Date.now() - started;
    const existing = await queryAs<ToolRow>(
      identity.userId,
      `select id, server_id, name, description, input_schema, enabled, reviewed_at
         from osirus.mcp_server_tools where server_id = $1::uuid`,
      [row.id],
    );
    const byName = new Map(existing.map((tool) => [tool.name, tool]));
    let added = 0;
    let changed = 0;
    let flagged = 0;
    for (const tool of tools) {
      if (tool.flagged) flagged += 1;
      const previous = byName.get(tool.remoteName);
      byName.delete(tool.remoteName);
      const stored = JSON.stringify({
        parameters: tool.parameters,
        fingerprint: tool.fingerprint,
        flagged: tool.flagged,
      });
      if (!previous) {
        added += 1;
        await queryAs(
          identity.userId,
          `insert into osirus.mcp_server_tools
             (organization_id, workspace_id, server_id, name, description, input_schema)
           values ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6::jsonb)
           on conflict (server_id, name) do nothing`,
          [
            identity.organizationId,
            identity.workspaceId,
            row.id,
            tool.remoteName,
            tool.description,
            stored,
          ],
        );
        continue;
      }
      const known = previous.input_schema?.fingerprint;
      // Rows from before fingerprints: what the reviewer saw was the
      // description and the parameter names. If both are unchanged the
      // fingerprint is recorded and the review stands; otherwise it is void.
      const legacyUnchanged =
        !known &&
        previous.description === tool.description &&
        JSON.stringify(previous.input_schema?.parameters ?? []) ===
          JSON.stringify(tool.parameters);
      if (known === tool.fingerprint || legacyUnchanged) {
        if (!known)
          await queryAs(
            identity.userId,
            `update osirus.mcp_server_tools set input_schema = $2::jsonb
              where id = $1::uuid`,
            [previous.id, stored],
          );
        continue;
      }
      changed += 1;
      await queryAs(
        identity.userId,
        `update osirus.mcp_server_tools
            set description = $2, input_schema = $3::jsonb,
                enabled = false, reviewed_at = null, reviewed_by = null
          where id = $1::uuid`,
        [previous.id, tool.description, stored],
      );
    }
    const removed = [...byName.values()];
    for (const tool of removed) {
      await queryAs(
        identity.userId,
        "delete from osirus.mcp_server_tools where id = $1::uuid",
        [tool.id],
      );
    }
    await queryAs(
      identity.userId,
      `update osirus.mcp_servers
          set status = 'healthy', server_name = $2, server_version = $3,
              last_checked_at = now(), last_ok_at = now(),
              last_latency_ms = $4, last_error = null, updated_at = now()
        where id = $1::uuid`,
      [row.id, info.name, info.version, latency],
    );
    await recordHealth(identity, `mcp:${row.id}`, {
      ok: true,
      latencyMs: latency,
      error: null,
    });
    if (flagged)
      await recordSecurityEvent(identity, {
        kind: "prompt_injection_neutralized",
        severity: "warning",
        summary: `${flagged} tool description${flagged === 1 ? "" : "s"} from MCP server "${row.name}" contained instructions aimed at the agent. They were neutralized and are shown as untrusted.`,
        detail: { server: row.name },
      });
    return {
      ok: true as const,
      latencyMs: latency,
      toolCount: tools.length,
      added,
      changed,
      removed: removed.length,
      flagged,
    };
  } catch (error) {
    const message = publicError(error);
    const latency = Date.now() - started;
    await queryAs(
      identity.userId,
      `update osirus.mcp_servers
          set status = 'failed', last_checked_at = now(),
              last_latency_ms = $2, last_error = $3, updated_at = now()
        where id = $1::uuid`,
      [row.id, latency, message],
    );
    await recordHealth(identity, `mcp:${row.id}`, {
      ok: false,
      latencyMs: latency,
      error: message,
    });
    if (error instanceof OutboundBlockedError)
      await recordSecurityEvent(identity, {
        kind: "outbound_blocked",
        severity: "warning",
        summary: `A request to MCP server "${row.name}" was blocked: ${error.reason.replaceAll("_", " ")}.`,
        detail: { server: row.name, reason: error.reason },
      });
    return { ok: false as const, latencyMs: latency, error: message };
  }
}

/** Switch off a tool whose definition changed after it was reviewed. */
async function voidReview(
  identity: Pick<ProductIdentity, "userId" | "workspaceId">,
  serverId: string,
  toolName: string,
) {
  const rows = await queryAs<{ organization_id: string }>(
    identity.userId,
    `update osirus.mcp_server_tools
        set enabled = false, reviewed_at = null, reviewed_by = null
      where server_id = $1::uuid and name = $2 and workspace_id = $3::uuid
      returning organization_id`,
    [serverId, toolName, identity.workspaceId],
  );
  if (rows[0])
    await recordSecurityEvent(
      {
        userId: identity.userId,
        organizationId: rows[0].organization_id,
        workspaceId: identity.workspaceId,
      },
      {
        kind: "tool_denied",
        severity: "warning",
        summary: `The MCP tool "${toolName.slice(0, 80)}" changed after it was reviewed. It was not run and is switched off until someone reviews it again.`,
        detail: { tool: toolName.slice(0, 128) },
      },
    );
}

/**
 * Enabled, reviewed tools on enabled servers, as registry definitions. A
 * tool without a recorded fingerprint (reviewed before fingerprints existed
 * and not checked since) is not offered until the server is checked again.
 */
export async function mcpToolsForWorkspace(
  identity: Pick<ProductIdentity, "userId" | "workspaceId">,
): Promise<ToolDefinition[]> {
  const rows = await queryAs<
    ServerRow & {
      tool_name: string;
      tool_description: string;
      parameters: string[] | null;
      fingerprint: string | null;
    }
  >(
    identity.userId,
    `select s.id, s.name, s.url, s.credential_reference, s.enabled, s.status,
            s.server_name, s.server_version, s.last_checked_at, s.last_ok_at,
            s.last_latency_ms, s.last_error,
            t.name as tool_name, t.description as tool_description,
            coalesce((select array_agg(value) from jsonb_array_elements_text(t.input_schema -> 'parameters')), '{}') as parameters,
            t.input_schema ->> 'fingerprint' as fingerprint
       from osirus.mcp_server_tools t
       join osirus.mcp_servers s on s.id = t.server_id
      where t.workspace_id = $1::uuid
        and t.enabled and t.reviewed_at is not null
        and s.enabled`,
    [identity.workspaceId],
  );
  return rows
    .filter((row) => Boolean(row.fingerprint))
    .map((row) => {
      const server = toServer(row);
      const tool = toolFromDiscovery({
        tool: {
          id: namespacedId(server.id, row.tool_name),
          serverId: server.id,
          remoteName: row.tool_name,
          description: row.tool_description,
          parameters: row.parameters ?? [],
          flagged: false,
          fingerprint: row.fingerprint!,
        },
        server,
        arms: ALL_ARMS,
        onChanged: () => voidReview(identity, row.id, row.tool_name),
      });
      return tool as ToolDefinition;
    });
}
