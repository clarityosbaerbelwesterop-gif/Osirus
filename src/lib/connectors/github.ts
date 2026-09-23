import "server-only";
import { queryAs } from "../db/client";
import { connectorKeyConfigured, decryptSecret, encryptSecret } from "./crypto";

// The GitHub connector.
//
// Separate from sign-in: logging in with GitHub proves who someone is and
// grants Osirus nothing on their repositories. Repository access comes only
// from a token the user adds here, explicitly, with scopes recorded in
// connector_grants. Reading is one grant; writing (push, pull request) is
// another, and a write still needs an approval on the run that uses it.
//
// The token is encrypted before it reaches the database and decrypted only at
// the moment a git command or API call needs it. It is never returned by an
// API route, never put in a prompt, and never written into a workspace.

export type GithubScope = "repo:read" | "repo:write";

export type GithubConnectorStatus =
  | { status: "NOT_CONFIGURED"; reason: string }
  | { status: "NOT_CONNECTED" }
  | {
      status: "CONNECTED";
      login: string;
      scopes: GithubScope[];
      tokenScopes: string | null;
      connectedAt: string;
    };

const TOKEN_PATTERN = /^(ghp_|github_pat_|gho_|ghu_|ghs_)[A-Za-z0-9_]{20,255}$/;

export function looksLikeGithubToken(value: string) {
  return TOKEN_PATTERN.test(value);
}

type Identity = { userId: string; organizationId: string; workspaceId: string };

type InstallationRow = {
  id: string;
  status: string;
  configuration: { login?: string; tokenScopes?: string | null };
  credential_reference: string | null;
  created_at: string | Date;
  scopes: GithubScope[] | null;
};

async function loadInstallation(identity: Identity) {
  const rows = await queryAs<InstallationRow>(
    identity.userId,
    `select i.id, i.status, i.configuration, i.credential_reference, i.created_at,
            (select coalesce(jsonb_agg(distinct s), '[]'::jsonb)
               from osirus.connector_grants g,
                    jsonb_array_elements_text(g.scopes) s
              where g.connector_installation_id = i.id
                and g.revoked_at is null
                and (g.expires_at is null or g.expires_at > now())) as scopes
       from osirus.connector_installations i
      where i.organization_id = $1 and i.workspace_id = $2
        and i.connector_id = 'github'
      limit 1`,
    [identity.organizationId, identity.workspaceId],
  );
  return rows[0] ?? null;
}

export async function githubConnectorStatus(
  identity: Identity,
): Promise<GithubConnectorStatus> {
  if (!connectorKeyConfigured())
    return {
      status: "NOT_CONFIGURED",
      reason: "OSIRUS_CONNECTOR_KEY is not set in this deployment.",
    };
  const row = await loadInstallation(identity);
  if (!row || row.status !== "active" || !row.credential_reference)
    return { status: "NOT_CONNECTED" };
  return {
    status: "CONNECTED",
    login: row.configuration.login ?? "unknown",
    scopes: row.scopes ?? [],
    tokenScopes: row.configuration.tokenScopes ?? null,
    connectedAt: new Date(row.created_at).toISOString(),
  };
}

/** Ask GitHub who the token belongs to. The token is sent to GitHub only. */
export async function verifyGithubToken(token: string) {
  const response = await fetch("https://api.github.com/user", {
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      "user-agent": "osirus",
    },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`github_token_rejected:${response.status}`);
  const body = (await response.json()) as { login?: string };
  return {
    login: body.login ?? "unknown",
    // Classic tokens report their scopes; fine-grained tokens do not, and
    // their repository permissions are enforced by GitHub on each call.
    tokenScopes: response.headers.get("x-oauth-scopes"),
  };
}

export async function connectGithub(
  identity: Identity,
  input: { token: string; scopes: GithubScope[] },
) {
  if (!connectorKeyConfigured())
    throw new Error("connector_key_not_configured");
  if (!looksLikeGithubToken(input.token)) throw new Error("token_malformed");
  const verified = await verifyGithubToken(input.token);
  const sealed = encryptSecret(input.token);
  const rows = await queryAs<{ id: string }>(
    identity.userId,
    `insert into osirus.connector_installations
       (organization_id, workspace_id, connector_id, status, configuration,
        credential_reference, installed_by)
     values ($1, $2, 'github', 'active', $3::jsonb, $4, $5)
     on conflict (organization_id, workspace_id, connector_id) do update set
       status = 'active',
       configuration = excluded.configuration,
       credential_reference = excluded.credential_reference
     returning id`,
    [
      identity.organizationId,
      identity.workspaceId,
      JSON.stringify({
        login: verified.login,
        tokenScopes: verified.tokenScopes,
      }),
      sealed,
      identity.userId,
    ],
  );
  const installationId = rows[0]!.id;
  await queryAs(
    identity.userId,
    `with revoked as (
       update osirus.connector_grants set revoked_at = now()
        where connector_installation_id = $1 and revoked_at is null
     )
     insert into osirus.connector_grants
       (connector_installation_id, organization_id, workspace_id, granted_by,
        grantee_type, grantee_id, scopes)
     values ($1, $2, $3, $4, 'workspace', $3::text, $5::jsonb)`,
    [
      installationId,
      identity.organizationId,
      identity.workspaceId,
      identity.userId,
      JSON.stringify([...new Set<GithubScope>(["repo:read", ...input.scopes])]),
    ],
  );
  return { login: verified.login };
}

export async function disconnectGithub(identity: Identity) {
  await queryAs(
    identity.userId,
    `with installation as (
       update osirus.connector_installations
          set status = 'revoked', credential_reference = null
        where organization_id = $1 and workspace_id = $2
          and connector_id = 'github'
        returning id
     )
     update osirus.connector_grants set revoked_at = now()
      where connector_installation_id in (select id from installation)
        and revoked_at is null`,
    [identity.organizationId, identity.workspaceId],
  );
}

/**
 * The token, for one git command or API call, if the workspace holds a live
 * grant for the scope. Null otherwise -- the caller reports NOT_CONNECTED or
 * a missing write grant; it never falls back to anything else.
 */
export async function githubCredential(identity: Identity, scope: GithubScope) {
  if (!connectorKeyConfigured()) return null;
  const row = await loadInstallation(identity);
  if (!row || row.status !== "active" || !row.credential_reference) return null;
  if (!(row.scopes ?? []).includes(scope)) return null;
  return decryptSecret(row.credential_reference);
}

/** owner/name from a github.com URL, or null. */
export function parseGithubRepository(url: string) {
  const match = url.match(
    /^https:\/\/github\.com\/([A-Za-z0-9-]{1,39})\/([A-Za-z0-9._-]{1,100}?)(?:\.git)?\/?$/,
  );
  return match ? { owner: match[1]!, name: match[2]! } : null;
}

export async function openPullRequest(input: {
  token: string;
  owner: string;
  name: string;
  head: string;
  base: string;
  title: string;
  body: string;
}) {
  const response = await fetch(
    `https://api.github.com/repos/${input.owner}/${input.name}/pulls`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${input.token}`,
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
        "user-agent": "osirus",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        title: input.title,
        body: input.body,
        head: input.head,
        base: input.base,
      }),
      signal: AbortSignal.timeout(15_000),
    },
  );
  const body = (await response.json().catch(() => ({}))) as {
    html_url?: string;
    number?: number;
    message?: string;
  };
  if (!response.ok)
    throw new Error(
      `pull_request_failed:${response.status}:${(body.message ?? "").slice(0, 120)}`,
    );
  return { url: body.html_url ?? null, number: body.number ?? null };
}
