// Shapes of MCP servers and tools as the interface shows them. No secrets:
// a stored token is reported only as present or absent.

export type McpToolView = {
  id: string;
  name: string;
  description: string;
  parameters: string[];
  enabled: boolean;
  reviewedAt: string | null;
  risk: "high";
};

export type McpServerView = {
  id: string;
  name: string;
  url: string;
  hasToken: boolean;
  enabled: boolean;
  status: "unchecked" | "healthy" | "degraded" | "failed";
  serverName: string | null;
  serverVersion: string | null;
  lastCheckedAt: string | null;
  lastOkAt: string | null;
  lastLatencyMs: number | null;
  lastError: string | null;
  toolCount: number;
  enabledToolCount: number;
  lastToolCallAt: string | null;
  tools: McpToolView[];
};
