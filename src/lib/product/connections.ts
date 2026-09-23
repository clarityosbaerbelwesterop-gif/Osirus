import "server-only";
import type { ProductIdentity } from "../auth/bootstrap";
import { githubConnectorStatus } from "../connectors/github";
import {
  checkGithubHealth,
  healthSummary,
  isStale,
  lastGithubToolCall,
} from "../connectors/health";
import { listMcpServers } from "../connectors/mcp-store";
import type { McpServerView } from "../connectors/mcp-types";

/**
 * Everything the Connections page shows. A connected GitHub token whose last
 * check is missing or stale is checked live first, so the page never reports
 * health it has not just observed.
 */
export async function loadConnections(identity: ProductIdentity) {
  const status = await githubConnectorStatus(identity).catch(() => ({
    status: "NOT_CONNECTED" as const,
  }));
  let health = null;
  let lastToolCallAt = null;
  if (status.status === "CONNECTED") {
    health = await healthSummary(identity, "github");
    if (isStale(health)) {
      await checkGithubHealth(identity).catch(() => null);
      health = await healthSummary(identity, "github");
    }
    lastToolCallAt = await lastGithubToolCall(identity);
  }
  let servers: McpServerView[] = [];
  let mcpAvailable = true;
  try {
    servers = await listMcpServers(identity);
  } catch {
    mcpAvailable = false;
  }
  return {
    github: {
      status: status.status,
      login: status.status === "CONNECTED" ? status.login : null,
      scopes: status.status === "CONNECTED" ? status.scopes : [],
      connectedAt: status.status === "CONNECTED" ? status.connectedAt : null,
      health,
      lastToolCallAt,
    },
    mcp: { servers, available: mcpAvailable },
  };
}
