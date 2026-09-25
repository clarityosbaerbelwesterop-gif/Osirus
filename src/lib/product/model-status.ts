import "server-only";
import type { ProductIdentity } from "../auth/bootstrap";
import { queryAs } from "../db/client";
import { env } from "../env";

// Model status, from what actually happened: the latest model calls in this
// workspace per role. Configuration alone never makes a role "available".
// People see plain words; administrators also see provider, model id and the
// failure category -- never keys, hosts or request bodies.

export const MODEL_ROLES = [
  "STRONG",
  "FAST",
  "THINKING",
  "CODING",
  "RESEARCH",
  "MATH",
  "VERIFY",
] as const;
export type ModelRoleId = (typeof MODEL_ROLES)[number];

const ROLE_LABEL: Record<ModelRoleId, string> = {
  STRONG: "Strong model",
  FAST: "Fast model",
  THINKING: "Thinking model",
  CODING: "Coding model",
  RESEARCH: "Research model",
  MATH: "Math model",
  VERIFY: "Verification model",
};

export type RoleState =
  | "available"
  | "busy"
  | "unavailable"
  | "quota_exhausted"
  | "configuration_error"
  | "not_used"
  | "not_configured";

export type RoleStatus = {
  role: ModelRoleId;
  label: string;
  state: RoleState;
  message: string;
  lastCallAt: string | null;
  calls24h: number;
  failures24h: number;
  /** Administrators only. */
  admin?: {
    provider: string;
    modelId: string | null;
    sharesStrong: boolean;
    failureCategory: string | null;
    lastFailureAt: string | null;
  };
};

const UNAVAILABLE = new Set([
  "insufficient_credit",
  "provider_unavailable",
  "credential_rejected",
  "model_not_configured",
  "provider_not_configured",
]);

export function configuredModel(role: ModelRoleId) {
  const map: Record<ModelRoleId, string | undefined> = {
    STRONG: env.OSIRUS_MODEL_STRONG,
    FAST: env.OSIRUS_MODEL_FAST,
    THINKING: env.OSIRUS_MODEL_THINKING ?? env.OSIRUS_MODEL_STRONG,
    CODING: env.OSIRUS_MODEL_CODING,
    RESEARCH: env.OSIRUS_MODEL_RESEARCH,
    MATH: env.OSIRUS_MODEL_MATH,
    VERIFY: env.OSIRUS_MODEL_VERIFY,
  };
  return map[role] ?? null;
}

type CallRow = {
  role: string;
  calls: number;
  failures: number;
  last_at: Date | string | null;
  last_status: string | null;
  last_error: string | null;
  last_failure_at: Date | string | null;
  last_failure_code: string | null;
};

/** Pure: the state and message for one role from its recent calls. */
export function roleState(
  configured: boolean,
  row: Pick<CallRow, "calls" | "last_status" | "last_error"> | null,
): { state: RoleState; message: string } {
  if (!configured)
    return {
      state: "not_configured",
      message: "Not set up on this deployment.",
    };
  if (!row || !row.calls)
    return { state: "not_used", message: "Not used in the last 24 hours." };
  if (row.last_status === "completed")
    return { state: "available", message: "Answering normally." };
  if (row.last_error === "rate_limited")
    return {
      state: "busy",
      message: "The provider is limiting requests. Runs wait and retry.",
    };
  // A permanent refusal is a state of the account, not an outage: say so
  // instead of promising a recovery that will not happen on its own.
  if (row.last_error === "insufficient_credit")
    return {
      state: "quota_exhausted",
      message:
        "Provider quota or credit exhausted. Retries keep failing until provider access is restored.",
    };
  if (
    row.last_error === "credential_rejected" ||
    row.last_error === "model_not_configured" ||
    row.last_error === "provider_not_configured"
  )
    return {
      state: "configuration_error",
      message:
        "Configuration problem (credentials or model setup). Retrying will not help.",
    };
  if (row.last_error && UNAVAILABLE.has(row.last_error))
    return { state: "unavailable", message: "Temporarily unavailable." };
  return { state: "available", message: "Recent requests had errors." };
}

export async function modelStatus(
  identity: ProductIdentity,
  isAdmin: boolean,
): Promise<RoleStatus[]> {
  const rows = await queryAs<CallRow>(
    identity.userId,
    `with recent as (
       select logical_role, status, error_code, created_at
         from osirus.model_calls
        where workspace_id = $1::uuid
          and created_at > now() - interval '24 hours'
          and status in ('completed', 'failed')
     )
     select r.logical_role as role,
            count(*)::int as calls,
            count(*) filter (where r.status = 'failed')::int as failures,
            max(r.created_at) as last_at,
            (select status from recent x where x.logical_role = r.logical_role
              order by created_at desc limit 1) as last_status,
            (select error_code from recent x where x.logical_role = r.logical_role
              order by created_at desc limit 1) as last_error,
            max(r.created_at) filter (where r.status = 'failed') as last_failure_at,
            (select error_code from recent x
              where x.logical_role = r.logical_role and x.status = 'failed'
              order by created_at desc limit 1) as last_failure_code
       from recent r
      group by r.logical_role`,
    [identity.workspaceId],
  ).catch(() => []);
  const byRole = new Map(rows.map((row) => [row.role.toUpperCase(), row]));
  const iso = (value: Date | string | null) =>
    value ? new Date(value).toISOString() : null;

  return MODEL_ROLES.map((role) => {
    const model = configuredModel(role);
    const row = byRole.get(role) ?? null;
    const { state, message } = roleState(Boolean(model), row);
    return {
      role,
      label: ROLE_LABEL[role],
      state,
      message,
      lastCallAt: iso(row?.last_at ?? null),
      calls24h: row?.calls ?? 0,
      failures24h: row?.failures ?? 0,
      ...(isAdmin
        ? {
            admin: {
              provider: "UnoRouter",
              modelId: model,
              sharesStrong: role === "THINKING" && !env.OSIRUS_MODEL_THINKING,
              failureCategory: row?.last_failure_code ?? null,
              lastFailureAt: iso(row?.last_failure_at ?? null),
            },
          }
        : {}),
    };
  });
}
