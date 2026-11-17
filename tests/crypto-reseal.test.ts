import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createTestDatabase, type TestDatabase } from "./helpers/pglite";

// Sealed secrets from before crypto v2 are sealed again, bound to their
// workspace, without changing what they open to.

const holder = vi.hoisted(() => ({ db: null as TestDatabase | null }));

vi.mock("server-only", () => ({}));
vi.mock("../src/lib/db/client", () => ({
  queryAs: (userId: string, text: string, params?: unknown[]) =>
    holder.db!.queryAs(userId, text, params),
  querySystem: (text: string, params?: unknown[]) =>
    holder.db!.querySystem(text, params),
  db: () => {
    throw new Error("tests never reach Neon");
  },
}));

const { env } = await import("../src/lib/env");
const { decryptSecret, needsReseal } =
  await import("../src/lib/connectors/crypto");
const { resealLegacySecrets } = await import("../src/lib/connectors/reseal");

const KEY = "r".repeat(48);
let db: TestDatabase;
const original = env.OSIRUS_CONNECTOR_KEY;

beforeAll(async () => {
  db = await createTestDatabase();
  holder.db = db;
  env.OSIRUS_CONNECTOR_KEY = KEY;
}, 120_000);
afterAll(async () => {
  if (original === undefined) delete env.OSIRUS_CONNECTOR_KEY;
  else env.OSIRUS_CONNECTOR_KEY = original;
  await db?.close();
});

/** A value as the v1 code sealed it: SHA-256 of the key, no AAD. */
function sealV1(plaintext: string) {
  const key = createHash("sha256").update(KEY, "utf8").digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  return [
    "v1",
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

describe("re-sealing legacy secrets", () => {
  it("turns a v1 MCP key into v2 bound to its workspace", async () => {
    const tenant = await db.seedTenant("reseal");
    const [row] = await db.raw<{ id: string }>(
      `insert into osirus.mcp_servers
         (organization_id, workspace_id, name, url, credential_reference, created_by)
       values ($1, $2, 'Docs', 'https://mcp.example.test/sse', $3, $4)
       returning id`,
      [
        tenant.organizationId,
        tenant.workspaceId,
        sealV1("mcp-key-123"),
        tenant.userId,
      ],
    );
    const result = await resealLegacySecrets();
    expect(result.mcpServers).toEqual({ resealed: 1, unreadable: 0 });
    const [after] = await db.raw<{ credential_reference: string }>(
      `select credential_reference from osirus.mcp_servers where id = $1`,
      [row!.id],
    );
    expect(after!.credential_reference).toMatch(/^v2\./);
    expect(needsReseal(after!.credential_reference)).toBe(false);
    expect(
      decryptSecret(after!.credential_reference, {
        purpose: "mcp",
        workspaceId: tenant.workspaceId,
      }),
    ).toBe("mcp-key-123");
    // Nothing left to do on a second pass.
    expect((await resealLegacySecrets()).mcpServers).toEqual({
      resealed: 0,
      unreadable: 0,
    });
  });

  it("leaves a value it cannot open untouched", async () => {
    const tenant = await db.seedTenant("broken");
    await db.raw(
      `insert into osirus.mcp_servers
         (organization_id, workspace_id, name, url, credential_reference, created_by)
       values ($1, $2, 'Kaputt', 'https://mcp.example.test/x', 'v1.AAAA.BBBB.CCCC', $3)`,
      [tenant.organizationId, tenant.workspaceId, tenant.userId],
    );
    const result = await resealLegacySecrets();
    expect(result.mcpServers!.unreadable).toBe(1);
    const rows = await db.raw<{ credential_reference: string }>(
      `select credential_reference from osirus.mcp_servers where name = 'Kaputt'`,
    );
    expect(rows[0]!.credential_reference).toBe("v1.AAAA.BBBB.CCCC");
  });
});
