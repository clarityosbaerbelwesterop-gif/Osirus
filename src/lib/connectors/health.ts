import "server-only";
import type { ProductIdentity } from "../auth/bootstrap";
import { queryAs } from "../db/client";
import { githubCredential, verifyGithubToken } from "./github";
import { notify } from "../product/notifications";

// Connection health: a real call to the provider, timed and recorded. Holding
// a credential is not health -- a connection is shown as healthy only after a
// check that reached the provider and was accepted.

export type HealthRecord = {
  ok: boolean;
  latencyMs: number | null;
  error: string | null;
  checkedAt: string;
};

export type HealthSummary = {
  last: HealthRecord | null;
  lastOkAt: string | null;
};

/** Re-check when the latest result is older than this. */
export const HEALTH_STALE_MS = 10 * 60 * 1000;

export async function recordHealth(
  identity: ProductIdentity,
  connectorId: string,
  result: { ok: boolean; latencyMs: number | null; error: string | null },
) {
  await queryAs(
    identity.userId,
    `insert into osirus.connector_health
       (organization_id, workspace_id, connector_id, ok, latency_ms, error, checked_by)
     values ($1::uuid, $2::uuid, $3, $4, $5, $6, $7::uuid)`,
    [
      identity.organizationId,
      identity.workspaceId,
      connectorId,
      result.ok,
      result.latencyMs,
      result.error?.slice(0, 500) ?? null,
      identity.userId,
    ],
  ).catch(() => undefined);
}

export async function healthSummary(
  identity: ProductIdentity,
  connectorId: string,
): Promise<HealthSummary> {
  const rows = await queryAs<{
    ok: boolean;
    latency_ms: number | null;
    error: string | null;
    checked_at: Date | string;
    last_ok_at: Date | string | null;
  }>(
    identity.userId,
    `select h.ok, h.latency_ms, h.error, h.checked_at,
            (select max(checked_at) from osirus.connector_health
              where workspace_id = $1::uuid and connector_id = $2 and ok) as last_ok_at
       from osirus.connector_health h
      where h.workspace_id = $1::uuid and h.connector_id = $2
      order by h.checked_at desc
      limit 1`,
    [identity.workspaceId, connectorId],
  ).catch(() => []);
  const row = rows[0];
  if (!row) return { last: null, lastOkAt: null };
  return {
    last: {
      ok: row.ok,
      latencyMs: row.latency_ms,
      error: row.error,
      checkedAt: new Date(row.checked_at).toISOString(),
    },
    lastOkAt: row.last_ok_at ? new Date(row.last_ok_at).toISOString() : null,
  };
}

export function isStale(summary: HealthSummary, now = Date.now()) {
  return (
    !summary.last || now - Date.parse(summary.last.checkedAt) > HEALTH_STALE_MS
  );
}

/** Ask GitHub whether the stored token still works, and record the answer. */
export async function checkGithubHealth(identity: ProductIdentity) {
  const token = await githubCredential(identity, "repo:read");
  if (!token) return null;
  const started = Date.now();
  let result: { ok: boolean; latencyMs: number; error: string | null };
  let expired = false;
  try {
    await verifyGithubToken(token);
    result = { ok: true, latencyMs: Date.now() - started, error: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const status = message.startsWith("github_token_rejected:")
      ? Number(message.split(":")[1])
      : null;
    expired = status === 401;
    result = {
      ok: false,
      latencyMs: Date.now() - started,
      error:
        status === 401
          ? "GitHub no longer accepts this token. It may have expired or been revoked."
          : status
            ? `GitHub answered with HTTP ${status}.`
            : "GitHub could not be reached.",
    };
  }
  await recordHealth(identity, "github", result);
  if (expired)
    await notify(identity, {
      kind: "connector_expired",
      title: "GitHub access expired",
      body: "Reconnect GitHub so Osirus can read and push to your repositories again.",
      dedupeKey: `connector_expired:github:${new Date().toISOString().slice(0, 10)}`,
    });
  return result;
}

/** When a GitHub tool last completed in this workspace. */
export async function lastGithubToolCall(identity: ProductIdentity) {
  const rows = await queryAs<{ at: Date | string | null }>(
    identity.userId,
    `select max(created_at) as at from osirus.tool_calls
      where workspace_id = $1::uuid and status = 'completed'
        and (tool_name = 'git.deliver' or tool_name like 'github.%')`,
    [identity.workspaceId],
  ).catch(() => []);
  const at = rows[0]?.at;
  return at ? new Date(at).toISOString() : null;
}
