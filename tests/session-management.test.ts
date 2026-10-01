import {
  afterAll,
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

// Conversation rename and archive, end to end: the PATCH and GET session
// routes run against a real Postgres (PGlite) with every migration and
// row-level security applied. Only the identity provider is mocked; the
// bootstrap and the repository use the seeded tenant.

const state = vi.hoisted(() => ({
  user: null as { id: string; email: string; name: string } | null,
  identity: null as TestIdentity | null,
}));

const holder = vi.hoisted(() => ({ db: null as TestDatabase | null }));

vi.mock("../src/lib/db/client", () => ({
  queryAs: (userId: string, text: string, params?: unknown[]) =>
    holder.db!.queryAs(userId, text, params),
  querySystem: (text: string, params?: unknown[]) =>
    holder.db!.querySystem(text, params),
  db: () => {
    throw new Error("tests never reach Neon");
  },
}));

vi.mock("@/lib/auth/server", () => ({
  requireAuthConfiguration: () => undefined,
  auth: {
    getSession: async () => ({
      data: state.user ? { user: state.user } : null,
    }),
  },
}));

vi.mock("@/lib/auth/bootstrap", () => ({
  bootstrapProductIdentity: async () => state.identity,
}));

const { PATCH } = await import("../src/app/api/sessions/[sessionId]/route");
const { GET } = await import("../src/app/api/sessions/route");
const { RuntimeRepository } = await import("../src/lib/runtime/repository");

let db: TestDatabase;
let tenant: TestIdentity;

beforeAll(async () => {
  db = await createTestDatabase();
  holder.db = db;
}, 120_000);

afterAll(async () => {
  await db?.close();
});

beforeEach(async () => {
  tenant = await db.seedTenant("session-management");
  state.identity = tenant;
  state.user = {
    id: tenant.userId,
    email: "session-management@example.test",
    name: "Session Management",
  };
});

function patchRequest(sessionId: string, body: unknown) {
  return new Request(`https://osirus.test/api/sessions/${sessionId}`, {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      origin: "https://osirus.test",
    },
    body: JSON.stringify(body),
  });
}

function listRequest(query = "") {
  return new Request(`https://osirus.test/api/sessions${query}`);
}

const paramsOf = (sessionId: string) => ({
  params: Promise.resolve({ sessionId }),
});

async function createSession(title = "First chat") {
  const repository = new RuntimeRepository(tenant.userId);
  return repository.createSession({
    organizationId: tenant.organizationId,
    workspaceId: tenant.workspaceId,
    title,
  });
}

async function storedTitle(sessionId: string) {
  const [row] = await db.raw<{ title: string }>(
    "select title from osirus.sessions where id = $1",
    [sessionId],
  );
  return row?.title;
}

describe("PATCH /api/sessions/[sessionId]", () => {
  it("renames a conversation and persists the trimmed title", async () => {
    const sessionId = await createSession();
    const response = await PATCH(
      patchRequest(sessionId, { title: "  Renovation plan  " }),
      paramsOf(sessionId),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      id: sessionId,
      title: "Renovation plan",
    });
    expect(await storedTitle(sessionId)).toBe("Renovation plan");
  });

  it("rejects an empty, whitespace-only or overlong title", async () => {
    const sessionId = await createSession();
    for (const title of ["", "   ", "x".repeat(241)]) {
      const response = await PATCH(
        patchRequest(sessionId, { title }),
        paramsOf(sessionId),
      );
      expect(response.status).toBe(400);
    }
    expect(await storedTitle(sessionId)).toBe("First chat");
  });

  it("rejects an update with no fields", async () => {
    const sessionId = await createSession();
    const response = await PATCH(
      patchRequest(sessionId, {}),
      paramsOf(sessionId),
    );
    expect(response.status).toBe(400);
  });

  it("renames nothing in another workspace", async () => {
    const other = await db.seedTenant("session-management-other");
    const otherRepository = new RuntimeRepository(other.userId);
    const foreignId = await otherRepository.createSession({
      organizationId: other.organizationId,
      workspaceId: other.workspaceId,
      title: "Not yours",
    });
    const response = await PATCH(
      patchRequest(foreignId, { title: "Taken over" }),
      paramsOf(foreignId),
    );
    expect(response.status).toBe(404);
    const [row] = await db.raw<{ title: string }>(
      "select title from osirus.sessions where id = $1",
      [foreignId],
    );
    expect(row?.title).toBe("Not yours");
  });

  it("still pins and unpins (regression)", async () => {
    const sessionId = await createSession();
    const pinned = await PATCH(
      patchRequest(sessionId, { pinned: true }),
      paramsOf(sessionId),
    );
    expect(pinned.status).toBe(200);
    expect(await pinned.json()).toEqual({ id: sessionId, pinned: true });
    const repository = new RuntimeRepository(tenant.userId);
    const [listed] = await repository.listWorkspaceSessions(tenant.workspaceId);
    expect(listed?.id).toBe(sessionId);
    expect(listed?.pinnedAt).not.toBeNull();
    const unpinned = await PATCH(
      patchRequest(sessionId, { pinned: false }),
      paramsOf(sessionId),
    );
    expect(unpinned.status).toBe(200);
  });

  it("refuses a stranger", async () => {
    state.user = null;
    const sessionId = await createSession();
    const response = await PATCH(
      patchRequest(sessionId, { title: "Nope" }),
      paramsOf(sessionId),
    );
    expect(response.status).toBe(401);
    expect(await storedTitle(sessionId)).toBe("First chat");
  });
});

describe("archiving", () => {
  it("hides archived conversations from the default list and restores them", async () => {
    const sessionId = await createSession("Archive me");
    const otherId = await createSession("Keep me");

    const archived = await PATCH(
      patchRequest(sessionId, { archived: true }),
      paramsOf(sessionId),
    );
    expect(archived.status).toBe(200);
    expect(await archived.json()).toEqual({ id: sessionId, archived: true });

    const active = await (await GET(listRequest())).json();
    expect(active.map((s: { id: string }) => s.id)).toEqual([otherId]);

    const archivedList = await (await GET(listRequest("?archived=1"))).json();
    expect(archivedList.map((s: { id: string }) => s.id)).toEqual([sessionId]);
    expect(archivedList[0].title).toBe("Archive me");

    const restored = await PATCH(
      patchRequest(sessionId, { archived: false }),
      paramsOf(sessionId),
    );
    expect(restored.status).toBe(200);
    const afterRestore = await (await GET(listRequest())).json();
    expect(afterRestore.map((s: { id: string }) => s.id).sort()).toEqual(
      [sessionId, otherId].sort(),
    );
    expect(await (await GET(listRequest("?archived=1"))).json()).toEqual([]);
  });

  it("archiving a session in another workspace is not found", async () => {
    const other = await db.seedTenant("session-management-other");
    const otherRepository = new RuntimeRepository(other.userId);
    const foreignId = await otherRepository.createSession({
      organizationId: other.organizationId,
      workspaceId: other.workspaceId,
      title: "Not yours",
    });
    const response = await PATCH(
      patchRequest(foreignId, { archived: true }),
      paramsOf(foreignId),
    );
    expect(response.status).toBe(404);
    const [row] = await db.raw<{ archived_at: string | null }>(
      "select archived_at from osirus.sessions where id = $1",
      [foreignId],
    );
    expect(row?.archived_at).toBeNull();
  });
});

describe("GET /api/sessions", () => {
  it("refuses a stranger", async () => {
    state.user = null;
    const response = await GET(listRequest());
    expect(response.status).toBe(401);
  });
});
