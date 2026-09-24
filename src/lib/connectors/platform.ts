import "server-only";
import { z } from "zod";
import type { ProductIdentity } from "../auth/bootstrap";
import { queryAs } from "../db/client";
import type { ToolDefinition } from "../tools/registry";
import { connectorKeyConfigured, decryptSecret, encryptSecret } from "./crypto";
import { recordHealth } from "./health";

// Platform connectors: Vercel, Neon and Supabase, by personal access token.
//
// The same rules as GitHub: the token is verified against the provider
// before it is stored, stored sealed, decrypted only for a call, and never
// returned, logged or put in a prompt. What the agent gets is read-only:
// listing deployments, projects and branches. Writes to these platforms
// (deploys, database changes) are not offered at all, so no approval floor
// is ever the only thing standing in the way.

export type PlatformId = "vercel" | "neon" | "supabase";

type Provider = {
  id: PlatformId;
  name: string;
  /** Verify the token and name the account it belongs to. */
  verify: (token: string) => Promise<{ account: string }>;
  tools: (token: () => Promise<string>) => ToolDefinition[];
};

async function getJson(
  url: string,
  token: string,
  init: { timeoutMs?: number } = {},
) {
  const response = await fetch(url, {
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/json",
      "user-agent": "osirus",
    },
    signal: AbortSignal.timeout(init.timeoutMs ?? 10_000),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`provider_rejected:${response.status}`);
  return (await response.json()) as Record<string, unknown>;
}

const list = (value: unknown) => (Array.isArray(value) ? value : []);
const text = (value: unknown) =>
  typeof value === "string" ? value.slice(0, 200) : null;

const readTool = (
  input: Pick<ToolDefinition, "id" | "title" | "summary"> & {
    arms?: ToolDefinition["arms"];
    schema?: z.ZodTypeAny;
    run: (args: Record<string, unknown>) => Promise<unknown>;
  },
): ToolDefinition => ({
  id: input.id,
  title: input.title,
  summary: input.summary,
  trust: "connector",
  effect: "read",
  risk: "low",
  arms: input.arms ?? ["building", "coding", "thinking", "general"],
  inputSchema: input.schema ?? z.object({}),
  run: (args) => input.run((args ?? {}) as Record<string, unknown>),
});

export const PROVIDERS: Record<PlatformId, Provider> = {
  vercel: {
    id: "vercel",
    name: "Vercel",
    verify: async (token) => {
      const body = await getJson("https://api.vercel.com/v2/user", token);
      const user = (body.user ?? {}) as Record<string, unknown>;
      return {
        account: text(user.username) ?? text(user.email) ?? "Vercel account",
      };
    },
    tools: (token) => [
      readTool({
        id: "vercel.deployments",
        title: "List Vercel deployments",
        summary:
          "Recent deployments of the connected Vercel account: project, state, target, URL and commit. Read only.",
        schema: z.object({
          project: z.string().max(100).optional(),
          limit: z.number().int().min(1).max(20).optional(),
        }),
        run: async (args) => {
          const params = new URLSearchParams({
            limit: String(args.limit ?? 10),
          });
          if (typeof args.project === "string")
            params.set("projectId", args.project);
          const body = await getJson(
            `https://api.vercel.com/v6/deployments?${params}`,
            await token(),
          );
          return {
            deployments: list(body.deployments).map((entry) => {
              const deployment = entry as Record<string, unknown>;
              const meta = (deployment.meta ?? {}) as Record<string, unknown>;
              return {
                project: text(deployment.name),
                state: text(deployment.state ?? deployment.readyState),
                target: text(deployment.target),
                url: text(deployment.url),
                commit: text(meta.githubCommitSha)?.slice(0, 12) ?? null,
                createdAt:
                  typeof deployment.created === "number"
                    ? new Date(deployment.created).toISOString()
                    : null,
              };
            }),
          };
        },
      }),
    ],
  },
  neon: {
    id: "neon",
    name: "Neon",
    verify: async (token) => {
      const body = await getJson(
        "https://console.neon.tech/api/v2/users/me",
        token,
      );
      return { account: text(body.email) ?? text(body.name) ?? "Neon account" };
    },
    tools: (token) => [
      readTool({
        id: "neon.projects",
        title: "List Neon projects and branches",
        summary:
          "Projects of the connected Neon account with their branches. Read only; no query runs against a database.",
        arms: ["building", "coding", "thinking", "general", "math_science"],
        run: async () => {
          const credential = await token();
          const body = await getJson(
            "https://console.neon.tech/api/v2/projects?limit=10",
            credential,
          );
          const projects = list(body.projects).slice(0, 10) as Array<
            Record<string, unknown>
          >;
          return {
            projects: await Promise.all(
              projects.map(async (project) => {
                const branches = await getJson(
                  `https://console.neon.tech/api/v2/projects/${encodeURIComponent(String(project.id))}/branches`,
                  credential,
                ).catch(() => ({ branches: [] }));
                return {
                  id: text(project.id),
                  name: text(project.name),
                  region: text(project.region_id),
                  branches: list(branches.branches)
                    .slice(0, 20)
                    .map((entry) => {
                      const branch = entry as Record<string, unknown>;
                      return {
                        name: text(branch.name),
                        primary: Boolean(branch.primary ?? branch.default),
                      };
                    }),
                };
              }),
            ),
          };
        },
      }),
    ],
  },
  supabase: {
    id: "supabase",
    name: "Supabase",
    verify: async (token) => {
      const body = await fetch("https://api.supabase.com/v1/projects", {
        headers: { authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(10_000),
        cache: "no-store",
      });
      if (!body.ok) throw new Error(`provider_rejected:${body.status}`);
      const projects = list(await body.json());
      return {
        account: `${projects.length} project${projects.length === 1 ? "" : "s"}`,
      };
    },
    tools: (token) => [
      readTool({
        id: "supabase.projects",
        title: "List Supabase projects",
        summary:
          "Projects of the connected Supabase account with region and status. Read only.",
        run: async () => {
          const response = await fetch("https://api.supabase.com/v1/projects", {
            headers: { authorization: `Bearer ${await token()}` },
            signal: AbortSignal.timeout(10_000),
            cache: "no-store",
          });
          if (!response.ok)
            throw new Error(`provider_rejected:${response.status}`);
          return {
            projects: list(await response.json())
              .slice(0, 20)
              .map((entry) => {
                const project = entry as Record<string, unknown>;
                return {
                  id: text(project.id ?? project.ref),
                  name: text(project.name),
                  region: text(project.region),
                  status: text(project.status),
                };
              }),
          };
        },
      }),
    ],
  },
};

type InstallationRow = {
  id: string;
  connector_id: PlatformId;
  status: string;
  configuration: { account?: string };
  credential_reference: string | null;
  created_at: string;
};

async function installations(identity: ProductIdentity) {
  return queryAs<InstallationRow>(
    identity.userId,
    `select id, connector_id, status, configuration, credential_reference,
            created_at
       from osirus.connector_installations
      where organization_id = $1 and workspace_id = $2
        and connector_id = any($3::text[])`,
    [identity.organizationId, identity.workspaceId, Object.keys(PROVIDERS)],
  );
}

export type PlatformStatus = {
  id: PlatformId;
  name: string;
  status: "NOT_CONFIGURED" | "NOT_CONNECTED" | "CONNECTED";
  account: string | null;
  connectedAt: string | null;
};

export async function platformStatuses(
  identity: ProductIdentity,
): Promise<PlatformStatus[]> {
  const configured = connectorKeyConfigured();
  const rows = configured ? await installations(identity).catch(() => []) : [];
  return Object.values(PROVIDERS).map((provider) => {
    const row = rows.find(
      (entry) =>
        entry.connector_id === provider.id &&
        entry.status === "active" &&
        entry.credential_reference,
    );
    return {
      id: provider.id,
      name: provider.name,
      status: !configured
        ? "NOT_CONFIGURED"
        : row
          ? "CONNECTED"
          : "NOT_CONNECTED",
      account: row?.configuration.account ?? null,
      connectedAt: row ? new Date(row.created_at).toISOString() : null,
    };
  });
}

export async function connectPlatform(
  identity: ProductIdentity,
  id: PlatformId,
  token: string,
) {
  if (!connectorKeyConfigured())
    throw new Error("connector_key_not_configured");
  const provider = PROVIDERS[id];
  const startedAt = Date.now();
  const verified = await provider.verify(token);
  await queryAs(
    identity.userId,
    `insert into osirus.connector_installations
       (organization_id, workspace_id, connector_id, status, configuration,
        credential_reference, installed_by)
     values ($1, $2, $3, 'active', $4::jsonb, $5, $6)
     on conflict (organization_id, workspace_id, connector_id) do update set
       status = 'active',
       configuration = excluded.configuration,
       credential_reference = excluded.credential_reference`,
    [
      identity.organizationId,
      identity.workspaceId,
      id,
      JSON.stringify({ account: verified.account }),
      encryptSecret(token),
      identity.userId,
    ],
  );
  await recordHealth(identity, id, {
    ok: true,
    latencyMs: Date.now() - startedAt,
    error: null,
  });
  return verified;
}

export async function disconnectPlatform(
  identity: ProductIdentity,
  id: PlatformId,
) {
  await queryAs(
    identity.userId,
    `update osirus.connector_installations
        set status = 'revoked', credential_reference = null
      where organization_id = $1 and workspace_id = $2 and connector_id = $3`,
    [identity.organizationId, identity.workspaceId, id],
  );
}

async function credential(identity: ProductIdentity, id: PlatformId) {
  const row = (await installations(identity)).find(
    (entry) =>
      entry.connector_id === id &&
      entry.status === "active" &&
      entry.credential_reference,
  );
  if (!row?.credential_reference) throw new Error(`${id}_not_connected`);
  return decryptSecret(row.credential_reference);
}

/** A live check against the provider, recorded as the connection's health. */
export async function checkPlatformHealth(
  identity: ProductIdentity,
  id: PlatformId,
) {
  const startedAt = Date.now();
  try {
    await PROVIDERS[id].verify(await credential(identity, id));
    const result = { ok: true, latencyMs: Date.now() - startedAt, error: null };
    await recordHealth(identity, id, result);
    return result;
  } catch (error) {
    const result = {
      ok: false,
      latencyMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : "check_failed",
    };
    await recordHealth(identity, id, result);
    return result;
  }
}

/** Read tools for every platform this workspace has connected. */
export async function platformToolsForWorkspace(identity: ProductIdentity) {
  if (!connectorKeyConfigured()) return [];
  const rows = await installations(identity);
  return rows
    .filter((row) => row.status === "active" && row.credential_reference)
    .flatMap((row) =>
      PROVIDERS[row.connector_id].tools(() =>
        credential(identity, row.connector_id),
      ),
    );
}
