import { randomBytes } from "node:crypto";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  createTestDatabase,
  type TestDatabase,
  type TestIdentity,
} from "./helpers/pglite";

// Section 11 of Issue #26: every connector's journey -- connect, verify,
// store, reload, health check, tool discovery, use, disconnect -- against the
// real product code and a real Postgres with every migration and row-level
// security applied. HTTP is mocked only at the provider boundary (GitHub,
// Vercel, Neon, Supabase), and every token is a random fake minted here.

const holder = vi.hoisted(() => ({
  db: null as TestDatabase | null,
  session: null as { identity: unknown } | null,
}));

vi.mock("../src/lib/db/client", () => ({
  queryAs: (userId: string, text: string, params?: unknown[]) =>
    holder.db!.queryAs(userId, text, params),
  querySystem: (text: string, params?: unknown[]) =>
    holder.db!.querySystem(text, params),
  db: () => {
    throw new Error("tests never reach Neon");
  },
}));
vi.mock("../src/lib/product/session", () => ({
  loadProductSession: async () => holder.session,
}));

process.env.OSIRUS_CONNECTOR_KEY = randomBytes(32).toString("hex");

const {
  connectGithub,
  disconnectGithub,
  githubConnectorStatus,
  githubCredential,
  openPullRequest,
} = await import("../src/lib/connectors/github");
const { checkGithubHealth, healthSummary } =
  await import("../src/lib/connectors/health");
const {
  checkPlatformHealth,
  connectPlatform,
  platformStatuses,
  platformToolsForWorkspace,
} = await import("../src/lib/connectors/platform");
const { loadConnections } = await import("../src/lib/product/connections");
const {
  createEndpoint,
  deleteEndpoint,
  endpointForDelivery,
  listEndpoints,
  recordDelivery,
} = await import("../src/lib/webhooks/store");
const { signGeneric, verifySignature, normalizeEvent } =
  await import("../src/lib/webhooks/verify");
const { decryptSecret } = await import("../src/lib/connectors/crypto");
const { ToolRegistry } = await import("../src/lib/tools/registry");
const { deliveryTool } = await import("../src/lib/coding/delivery");
const platformRoute =
  await import("../src/app/api/connectors/platform/[platform]/route");

// ---------------------------------------------------------------------------
// The provider boundary.

type ProviderCall = {
  host: string;
  path: string;
  authorization: string | null;
};

const provider = {
  valid: new Set<string>(),
  calls: [] as ProviderCall[],
  down: false,
};

function bearer(headers: HeadersInit | undefined) {
  const value = new Headers(headers).get("authorization");
  return value?.startsWith("Bearer ") ? value.slice(7) : null;
}

const json = (
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });

async function providerFetch(input: RequestInfo | URL, init?: RequestInit) {
  const url = new URL(typeof input === "string" ? input : input.toString());
  const token = bearer(init?.headers);
  provider.calls.push({
    host: url.host,
    path: url.pathname,
    authorization: token ? "Bearer <redacted>" : null,
  });
  if (provider.down) throw new TypeError("fetch failed");
  if (!token || !provider.valid.has(token))
    return json({ message: "Bad credentials" }, 401);
  const route = `${url.host}${url.pathname}`;
  switch (route) {
    case "api.github.com/user":
      return json({ login: "cert-octocat" }, 200, { "x-oauth-scopes": "" });
    case "api.github.com/repos/cert-octocat/demo/pulls":
      return json(
        { html_url: "https://github.com/cert-octocat/demo/pull/7", number: 7 },
        201,
      );
    case "api.vercel.com/v2/user":
      return json({ user: { username: "cert-vercel" } });
    case "api.vercel.com/v6/deployments":
      return json({
        deployments: [
          {
            name: "osirus",
            state: "READY",
            target: "production",
            url: "osirus-abc.vercel.app",
            meta: { githubCommitSha: "e30a1a3821b9e79e5926dfb2" },
            created: Date.UTC(2026, 8, 25),
          },
        ],
      });
    case "console.neon.tech/api/v2/users/me":
      return json({ email: "cert@example.test" });
    case "console.neon.tech/api/v2/projects":
      return json({
        projects: [
          { id: "proj-1", name: "cert", region_id: "aws-eu-central-1" },
        ],
      });
    case "console.neon.tech/api/v2/projects/proj-1/branches":
      return json({
        branches: [{ name: "main", primary: true }, { name: "dev" }],
      });
    case "api.supabase.com/v1/projects":
      return json([
        {
          id: "ref-1",
          name: "cert",
          region: "eu-central-1",
          status: "ACTIVE_HEALTHY",
        },
      ]);
    default:
      return json({ message: "not found" }, 404);
  }
}

function fakeToken(prefix: string) {
  return `${prefix}${randomBytes(24).toString("hex")}`;
}

// Everything written to the console during the suite; checked for tokens.
const consoleOutput: string[] = [];
const minted: string[] = [];
function mint(prefix: string) {
  const token = fakeToken(prefix);
  minted.push(token);
  provider.valid.add(token);
  return token;
}

let db: TestDatabase;
let alice: TestIdentity;
let mallory: TestIdentity;

beforeAll(async () => {
  db = await createTestDatabase();
  holder.db = db;
  alice = await db.seedTenant("alice");
  mallory = await db.seedTenant("mallory");
  for (const level of ["log", "info", "warn", "error", "debug"] as const)
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
      consoleOutput.push(args.map(String).join(" "));
    });
}, 120_000);

afterAll(async () => {
  // No token ever reached a log line, in any test.
  for (const token of minted)
    expect(consoleOutput.join("\n")).not.toContain(token);
  vi.restoreAllMocks();
  await db?.close();
});

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(providerFetch));
  provider.calls.length = 0;
  provider.down = false;
});
afterEach(() => {
  vi.unstubAllGlobals();
});

/** Every place a token could leak to at rest, as one string. */
async function everythingStored() {
  const tables = [
    "connector_installations",
    "connector_grants",
    "connector_health",
    "notifications",
    "security_events",
    "webhook_endpoints",
  ];
  const dumps = await Promise.all(
    tables.map((table) => db.raw(`select * from osirus.${table}`)),
  );
  return JSON.stringify(dumps);
}

const toolContext = (identity: TestIdentity) => ({
  runId: "00000000-0000-4000-8000-000000000001",
  stageId: "00000000-0000-4000-8000-000000000002",
  armId: "building" as const,
  organizationId: identity.organizationId,
  workspaceId: identity.workspaceId,
});

// ---------------------------------------------------------------------------

describe("GitHub repository connector (fine-grained PAT, separate from GitHub login)", () => {
  it("VERIFY: a token GitHub rejects is not stored", async () => {
    const rejected = fakeToken("github_pat_");
    minted.push(rejected);
    await expect(
      connectGithub(alice, { token: rejected, scopes: [] }),
    ).rejects.toThrow(/github_token_rejected:401/);
    await expect(
      connectGithub(alice, { token: "not-a-token", scopes: [] }),
    ).rejects.toThrow("token_malformed");
    expect((await githubConnectorStatus(alice)).status).toBe("NOT_CONNECTED");
    expect(await everythingStored()).not.toContain(rejected);
  });

  it("walks connect → store → reload → health → use → disconnect", async () => {
    const token = mint("github_pat_");

    // CONNECT + VERIFY: GitHub was asked who owns the token, and only GitHub.
    await expect(connectGithub(alice, { token, scopes: [] })).resolves.toEqual({
      login: "cert-octocat",
    });
    expect(provider.calls.map((call) => call.host)).toEqual(["api.github.com"]);

    // STORE: sealed with AES-256-GCM, never in plaintext anywhere at rest.
    const [row] = await db.raw<{ credential_reference: string }>(
      `select credential_reference from osirus.connector_installations
        where workspace_id = $1 and connector_id = 'github'`,
      [alice.workspaceId],
    );
    expect(row!.credential_reference).toMatch(/^v1\./);
    expect(decryptSecret(row!.credential_reference)).toBe(token);
    expect(await everythingStored()).not.toContain(token);

    // RELOAD: a later request sees the connection, never the token.
    const status = await githubConnectorStatus(alice);
    expect(status).toMatchObject({
      status: "CONNECTED",
      login: "cert-octocat",
      scopes: ["repo:read"],
    });
    const page = await loadConnections({ ...alice });
    expect(page.github.status).toBe("CONNECTED");
    expect(JSON.stringify(page)).not.toContain(token);

    // Tenant isolation: another workspace sees nothing and gets no token.
    expect((await githubConnectorStatus(mallory)).status).toBe("NOT_CONNECTED");
    expect(await githubCredential(mallory, "repo:read")).toBeNull();

    // HEALTH: a live call, recorded.
    await expect(checkGithubHealth({ ...alice })).resolves.toMatchObject({
      ok: true,
    });
    expect((await healthSummary({ ...alice }, "github")).last?.ok).toBe(true);

    // TOOL DISCOVERY: read grant only -- the write grant is absent, so the
    // delivery tool has no credential and would refuse.
    expect(await githubCredential(alice, "repo:read")).toBe(token);
    expect(await githubCredential(alice, "repo:write")).toBeNull();

    // Reconnect with write access: grants are replaced, not accumulated.
    const liveGrants = () =>
      db.raw<{ scopes: string[] }>(
        `select g.scopes from osirus.connector_grants g
           join osirus.connector_installations i on i.id = g.connector_installation_id
          where i.workspace_id = $1 and g.revoked_at is null`,
        [alice.workspaceId],
      );
    await connectGithub(alice, { token, scopes: ["repo:write"] });
    expect(await liveGrants()).toEqual([
      { scopes: ["repo:read", "repo:write"] },
    ]);
    expect(await githubCredential(alice, "repo:write")).toBe(token);
    // ...and dropping write access really drops it.
    await connectGithub(alice, { token, scopes: [] });
    expect(await liveGrants()).toEqual([{ scopes: ["repo:read"] }]);
    expect(await githubCredential(alice, "repo:write")).toBeNull();
    await connectGithub(alice, { token, scopes: ["repo:write"] });

    // USE: open a pull request; the token goes to api.github.com only.
    provider.calls.length = 0;
    const credential = await githubCredential(alice, "repo:write");
    await expect(
      openPullRequest({
        token: credential!,
        owner: "cert-octocat",
        name: "demo",
        head: "osirus/cert",
        base: "main",
        title: "cert",
        body: "cert",
      }),
    ).resolves.toEqual({
      url: "https://github.com/cert-octocat/demo/pull/7",
      number: 7,
    });
    expect(provider.calls.every((call) => call.host === "api.github.com")).toBe(
      true,
    );

    // HEALTH after revocation at GitHub: failure recorded, person notified.
    provider.valid.delete(token);
    const failed = await checkGithubHealth({ ...alice });
    expect(failed).toMatchObject({ ok: false });
    expect(failed!.error).toMatch(/no longer accepts this token/);
    expect(failed!.error).not.toContain(token);
    const [notice] = await db.raw<{ kind: string }>(
      `select kind from osirus.notifications where workspace_id = $1`,
      [alice.workspaceId],
    );
    expect(notice?.kind).toBe("connector_expired");
    provider.valid.add(token);

    // DISCONNECT: the sealed credential is gone and every grant revoked.
    await disconnectGithub(alice);
    const [after] = await db.raw<{
      status: string;
      credential_reference: string | null;
    }>(
      `select status, credential_reference from osirus.connector_installations
        where workspace_id = $1 and connector_id = 'github'`,
      [alice.workspaceId],
    );
    expect(after).toEqual({ status: "revoked", credential_reference: null });
    const live = await db.raw(
      `select 1 from osirus.connector_grants g
         join osirus.connector_installations i on i.id = g.connector_installation_id
        where i.workspace_id = $1 and g.revoked_at is null`,
      [alice.workspaceId],
    );
    expect(live).toHaveLength(0);
    expect((await githubConnectorStatus(alice)).status).toBe("NOT_CONNECTED");
    expect(await githubCredential(alice, "repo:read")).toBeNull();
    expect(await checkGithubHealth({ ...alice })).toBeNull();

    // The delivery tool now refuses before touching git or GitHub.
    const registry = new ToolRegistry({ approvalGate: async () => "approved" });
    registry.register(
      deliveryTool({
        workspace: async () => {
          throw new Error("git must not run");
        },
        repository: () => ({ owner: "cert-octocat", name: "demo" }),
        baseBranch: () => "main",
        writeCredential: () => githubCredential(alice, "repo:write"),
        openPullRequest,
      }),
    );
    provider.calls.length = 0;
    const result = await registry.invoke({
      toolId: "git.deliver",
      rawInput: { branch: "b", commitMessage: "m", title: "t", body: "" },
      context: toolContext(alice),
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/github_write_grant_missing/);
    expect(provider.calls).toHaveLength(0);
    expect(await everythingStored()).not.toContain(token);
  });
});

// ---------------------------------------------------------------------------

const PLATFORMS = [
  {
    id: "vercel" as const,
    host: "api.vercel.com",
    account: "cert-vercel",
    tool: "vercel.deployments",
    expectUse: (data: unknown) =>
      expect(data).toMatchObject({
        deployments: [
          { project: "osirus", state: "READY", commit: "e30a1a3821b9" },
        ],
      }),
  },
  {
    id: "neon" as const,
    host: "console.neon.tech",
    account: "cert@example.test",
    tool: "neon.projects",
    expectUse: (data: unknown) =>
      expect(data).toMatchObject({
        projects: [
          {
            id: "proj-1",
            branches: [
              { name: "main", primary: true },
              { name: "dev", primary: false },
            ],
          },
        ],
      }),
  },
  {
    id: "supabase" as const,
    host: "api.supabase.com",
    account: "1 project",
    tool: "supabase.projects",
    expectUse: (data: unknown) =>
      expect(data).toMatchObject({
        projects: [{ id: "ref-1", status: "ACTIVE_HEALTHY" }],
      }),
  },
];

describe.each(PLATFORMS)(
  "$id connector (personal access token)",
  (platform) => {
    it("VERIFY: a rejected or unreachable token is not stored", async () => {
      const rejected = fakeToken(`${platform.id}_`);
      minted.push(rejected);
      await expect(
        connectPlatform({ ...alice }, platform.id, rejected),
      ).rejects.toThrow(/provider_rejected:401/);
      provider.down = true;
      await expect(
        connectPlatform({ ...alice }, platform.id, mint(`${platform.id}_`)),
      ).rejects.toThrow();
      provider.down = false;
      const status = (await platformStatuses({ ...alice })).find(
        (p) => p.id === platform.id,
      );
      expect(status?.status).toBe("NOT_CONNECTED");
      expect(await everythingStored()).not.toContain(rejected);
    });

    it("walks connect → store → reload → health → discovery → use → disconnect", async () => {
      const token = mint(`${platform.id}_`);
      const me = { ...alice };

      // CONNECT + VERIFY
      await expect(connectPlatform(me, platform.id, token)).resolves.toEqual({
        account: platform.account,
      });
      expect(provider.calls.map((call) => call.host)).toEqual([platform.host]);

      // STORE
      const [row] = await db.raw<{ credential_reference: string }>(
        `select credential_reference from osirus.connector_installations
        where workspace_id = $1 and connector_id = $2`,
        [alice.workspaceId, platform.id],
      );
      expect(row!.credential_reference).toMatch(/^v1\./);
      expect(decryptSecret(row!.credential_reference)).toBe(token);
      expect(await everythingStored()).not.toContain(token);

      // RELOAD (and the whole Connections page payload carries no token)
      const status = (await platformStatuses(me)).find(
        (p) => p.id === platform.id,
      );
      expect(status).toMatchObject({
        status: "CONNECTED",
        account: platform.account,
      });
      const page = await loadConnections(me);
      expect(
        page.platforms.find((p) => p.id === platform.id)?.health?.last?.ok,
      ).toBe(true);
      expect(JSON.stringify(page)).not.toContain(token);
      expect(
        (await platformStatuses({ ...mallory })).find(
          (p) => p.id === platform.id,
        )?.status,
      ).toBe("NOT_CONNECTED");

      // HEALTH through the API route: the response carries no token.
      holder.session = { identity: me };
      const request = (body: unknown) =>
        new Request(
          `https://osirus.test/api/connectors/platform/${platform.id}`,
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              origin: "https://osirus.test",
            },
            body: JSON.stringify(body),
          },
        );
      const params = { params: Promise.resolve({ platform: platform.id }) };
      const checked = await platformRoute.POST(
        request({ action: "check" }),
        params,
      );
      expect(checked.status).toBe(200);
      const checkedBody = await checked.text();
      expect(JSON.parse(checkedBody)).toMatchObject({ health: { ok: true } });
      expect(checkedBody).not.toContain(token);

      // TOOL DISCOVERY: read-only, low risk, no approval needed, nothing else.
      const tools = await platformToolsForWorkspace(me);
      const own = tools.filter((tool) => tool.id.startsWith(`${platform.id}.`));
      expect(own.map((tool) => tool.id)).toEqual([platform.tool]);
      expect(own[0]).toMatchObject({
        trust: "connector",
        effect: "read",
        risk: "low",
      });

      // USE through the registry; the token goes to the provider only and is
      // not in the result.
      const registry = new ToolRegistry();
      registry.register(own[0]!);
      provider.calls.length = 0;
      const used = await registry.invoke({
        toolId: platform.tool,
        rawInput: {},
        context: toolContext(alice),
      });
      expect(used.ok).toBe(true);
      platform.expectUse(used.data);
      expect(JSON.stringify(used)).not.toContain(token);
      expect(provider.calls.every((call) => call.host === platform.host)).toBe(
        true,
      );

      // HEALTH after revocation at the provider: a readable failure.
      provider.valid.delete(token);
      const failed = await checkPlatformHealth(me, platform.id);
      expect(failed?.ok).toBe(false);
      expect(failed?.error).toMatch(/no longer accepts this token/);
      provider.valid.add(token);

      // DISCONNECT through the API route.
      const removed = await platformRoute.DELETE(
        new Request(
          `https://osirus.test/api/connectors/platform/${platform.id}`,
          {
            method: "DELETE",
            headers: { origin: "https://osirus.test" },
          },
        ),
        params,
      );
      expect(removed.status).toBe(200);
      const [after] = await db.raw<{
        status: string;
        credential_reference: string | null;
      }>(
        `select status, credential_reference from osirus.connector_installations
        where workspace_id = $1 and connector_id = $2`,
        [alice.workspaceId, platform.id],
      );
      expect(after).toEqual({ status: "revoked", credential_reference: null });
      expect(
        (await platformStatuses(me)).find((p) => p.id === platform.id)?.status,
      ).toBe("NOT_CONNECTED");
      // Tools are gone from the next run...
      expect(
        (await platformToolsForWorkspace(me)).some(
          (tool) => tool.id === platform.tool,
        ),
      ).toBe(false);
      // ...and a tool handed out before the disconnect has no credential left.
      const stale = await registry.invoke({
        toolId: platform.tool,
        rawInput: {},
        context: toolContext(alice),
      });
      expect(stale.ok).toBe(false);
      expect(stale.error).toBe(`${platform.id}_not_connected`);
      // A health check of a connection that no longer exists is a 409, not a
      // recorded failure.
      expect(await checkPlatformHealth(me, platform.id)).toBeNull();
      const again = await platformRoute.POST(
        request({ action: "check" }),
        params,
      );
      expect(again.status).toBe(409);
      holder.session = null;
      expect(await everythingStored()).not.toContain(token);
    });
  },
);

// ---------------------------------------------------------------------------

describe("webhook endpoints", () => {
  it("walks create → store → reload → deliver → health → delete", async () => {
    // CONNECT: the signing secret is returned exactly once.
    const { endpoint, secret } = await createEndpoint(alice, {
      name: "cert",
      source: "generic",
      events: ["generic"],
    });
    minted.push(secret);
    expect(secret).toMatch(/^[0-9a-f]{64}$/);

    // STORE: sealed.
    const [row] = await db.raw<{ secret_sealed: string }>(
      `select secret_sealed from osirus.webhook_endpoints where id = $1`,
      [endpoint.id],
    );
    expect(row!.secret_sealed).toMatch(/^v1\./);
    expect(await everythingStored()).not.toContain(secret);

    // RELOAD: listed without the secret; invisible to another tenant.
    const listed = await listEndpoints(alice);
    expect(listed.map((entry) => entry.id)).toEqual([endpoint.id]);
    expect(JSON.stringify(listed)).not.toContain(secret);
    expect(await listEndpoints(mallory)).toEqual([]);
    expect(await deleteEndpoint(mallory, endpoint.id)).toBe(false);

    // USE: the receiver verifies the signature with the unsealed secret and
    // records each delivery once.
    const found = await endpointForDelivery(endpoint.id);
    expect(found?.secret).toBe(secret);
    const now = Date.now();
    const timestamp = Math.floor(now / 1000);
    const body = JSON.stringify({ event: "cert", id: "delivery-1" });
    const headers = new Headers({
      "x-osirus-timestamp": String(timestamp),
      "x-osirus-signature": signGeneric(secret, timestamp, body),
      "x-osirus-delivery": "delivery-1",
    });
    expect(
      verifySignature({
        source: "generic",
        secret: found!.secret,
        body,
        headers,
        now,
      }),
    ).toEqual({ ok: true });
    expect(
      verifySignature({
        source: "generic",
        secret: "f".repeat(64),
        body,
        headers,
        now,
      }).ok,
    ).toBe(false);
    const event = normalizeEvent({ source: "generic", headers, body });
    expect(event).not.toBeNull();
    expect(await recordDelivery(found!.row, event!, "triggered")).toBe(true);
    expect(await recordDelivery(found!.row, event!, "triggered")).toBe(false);

    // HEALTH: the last delivery is what the card shows.
    const [health] = await listEndpoints(alice);
    expect(health?.lastStatus).toBe("triggered");
    expect(health?.lastDeliveryAt).not.toBeNull();

    // DISCONNECT: the endpoint and its sealed secret are gone; the receiver
    // no longer finds it, so a correctly signed delivery is refused.
    expect(await deleteEndpoint(alice, endpoint.id)).toBe(true);
    expect(await endpointForDelivery(endpoint.id)).toBeNull();
    expect(
      await db.raw(`select 1 from osirus.webhook_endpoints where id = $1`, [
        endpoint.id,
      ]),
    ).toHaveLength(0);
  });
});
