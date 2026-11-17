import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const calls: Array<{ text: string; params: unknown[] }> = [];
let subscription: Record<string, unknown> | null = null;

vi.mock("../src/lib/db/client", () => ({
  queryAs: async (_user: string, text: string, params: unknown[]) => {
    calls.push({ text, params });
    if (text.includes("osirus.mcp_servers t"))
      return [
        {
          rows: [
            {
              name: "Suche",
              url: "https://user:pw@mcp.example.com/a1B2c3D4e5F6g7H8i9J0kLmN/sse?api_key=sk-live-123",
            },
          ],
        },
      ];
    if (text.includes("jsonb_agg")) return [{ rows: [{ ok: true }] }];
    return [];
  },
  querySystem: async () => [],
}));
vi.mock("../src/lib/billing/store", () => ({
  currentSubscription: async () => subscription,
}));

const {
  recentlySignedIn,
  deleteAccount,
  exportAccountData,
  exportStatement,
  AccountDeletionBlocked,
} = await import("../src/lib/privacy/account");

const identity = {
  userId: "11111111-1111-4111-8111-111111111111",
  organizationId: "22222222-2222-4222-8222-222222222222",
  workspaceId: "33333333-3333-4333-8333-333333333333",
  workspaceName: "Personal",
};

beforeEach(() => {
  calls.length = 0;
  subscription = null;
});

describe("data export (Art. 15/20)", () => {
  it("never carries sealed tokens or embeddings and scopes every table", () => {
    const sql = exportStatement({
      key: "mcpServers",
      table: "mcp_servers",
      scope: "workspace",
    });
    expect(sql).toContain("- 'credential_reference'");
    expect(sql).toContain("- 'embedding'");
    expect(sql).toContain("t.workspace_id = $1::uuid");
    expect(sql).not.toContain("$2");
    expect(
      exportStatement({ key: "profile", table: "users", scope: "self" }),
    ).toContain("t.id = $1::uuid");
    expect(
      exportStatement({
        key: "subs",
        table: "billing_subscriptions",
        scope: "user",
      }),
    ).toContain("t.user_id = $1::uuid");
  });

  it("collects the person's data as the person, behind row-level security", async () => {
    const result = await exportAccountData(identity);
    expect(result.format).toBe("osirus-account-export/1");
    expect(Object.keys(result.data)).toEqual(
      expect.arrayContaining([
        "profile",
        "messages",
        "bots",
        "memory",
        "connections",
      ]),
    );
    // Exactly one parameter per statement, the one it filters by.
    expect(calls.every((call) => call.params.length === 1)).toBe(true);
    const byTable = (table: string) =>
      calls.find((call) => call.text.includes(`osirus.${table} t`))!.params[0];
    expect(byTable("users")).toBe(identity.userId);
    expect(byTable("messages")).toBe(identity.workspaceId);
    expect(byTable("billing_subscriptions")).toBe(identity.userId);
  });

  it("masks keys inside MCP server URLs, as the export note promises", async () => {
    const result = await exportAccountData(identity);
    const text = JSON.stringify(result.data.mcpServers);
    expect(text).not.toContain("sk-live-123");
    expect(text).not.toContain("a1B2c3D4e5F6g7H8i9J0kLmN");
    expect(text).not.toContain("pw@");
    expect(result.data.mcpServers).toEqual([
      {
        name: "Suche",
        url: "https://***:***@mcp.example.com/***/sse?api_key=***",
      },
    ]);
  });
});

describe("account deletion (Art. 17)", () => {
  it("deletes the personal organization, then the sign-in", async () => {
    await deleteAccount(identity, { endSubscription: false });
    expect(
      calls.map((call) => call.text.trim().split(/\s+/).slice(0, 3).join(" ")),
    ).toEqual([
      "delete from osirus.organizations",
      "select osirus.delete_own_auth_user()",
    ]);
  });

  it("stops at a running paid plan unless the person confirmed ending it", async () => {
    subscription = {
      plan: "pro",
      status: "active",
      stripe_subscription_id: "sub_1",
    };
    await expect(
      deleteAccount(identity, { endSubscription: false }),
    ).rejects.toBeInstanceOf(AccountDeletionBlocked);
    expect(calls).toHaveLength(0);
    const cancelled: string[] = [];
    await deleteAccount(
      identity,
      { endSubscription: true },
      {
        cancelSubscription: async (id) => void cancelled.push(id),
      },
    );
    expect(cancelled).toEqual(["sub_1"]);
    expect(calls).toHaveLength(2);
  });

  it("ends every subscription Stripe still bills, also past_due and a second one", async () => {
    subscription = null;
    calls.length = 0;
    const cancelled: string[] = [];
    await deleteAccount(
      identity,
      { endSubscription: true },
      {
        liveSubscriptions: async () => ["sub_pro", "sub_dev_past_due"],
        cancelSubscription: async (id) => void cancelled.push(id),
      },
    );
    expect(cancelled).toEqual(["sub_pro", "sub_dev_past_due"]);
    expect(calls).toHaveLength(2);
  });

  it("deletes nothing when the subscriptions cannot be read", async () => {
    calls.length = 0;
    await expect(
      deleteAccount(
        identity,
        { endSubscription: true },
        {
          liveSubscriptions: async () => {
            throw new Error("stripe down");
          },
          cancelSubscription: async () => undefined,
        },
      ),
    ).rejects.toThrow("stripe down");
    expect(calls).toHaveLength(0);
  });

  it("does not block on an ended plan", async () => {
    subscription = {
      plan: "pro",
      status: "canceled",
      stripe_subscription_id: "sub_2",
    };
    await deleteAccount(identity, { endSubscription: false });
    expect(calls).toHaveLength(2);
  });
});

describe("a deleted sign-in", () => {
  it("is recognised by the foreign-key violation, nothing else", async () => {
    vi.doMock("next/navigation", () => ({ redirect: () => undefined }));
    vi.doMock("../src/lib/auth/server", () => ({
      auth: {},
      requireAuthConfiguration: () => undefined,
    }));
    const { signInGone } = await import("../src/lib/product/session");
    expect(signInGone({ code: "23503" })).toBe(true);
    expect(signInGone({ code: "23505" })).toBe(false);
    expect(signInGone(new Error("boom"))).toBe(false);
    expect(signInGone(null)).toBe(false);
  });
});

describe("deleting needs a recent sign-in and removes the Stripe customer", () => {
  it("accepts a session from the last 15 minutes only", () => {
    const now = Date.parse("2026-11-17T12:00:00Z");
    expect(recentlySignedIn("2026-11-17T11:50:00Z", now)).toBe(true);
    expect(recentlySignedIn("2026-11-17T11:44:00Z", now)).toBe(false);
    expect(recentlySignedIn(null, now)).toBe(false);
    expect(recentlySignedIn("kein Datum", now)).toBe(false);
    // A clock far in the future is not "recent".
    expect(recentlySignedIn("2026-11-18T12:00:00Z", now)).toBe(false);
  });

  it("deletes the Stripe customer before the account, and stops if that fails", async () => {
    calls.length = 0;
    const order: string[] = [];
    await deleteAccount(
      identity,
      { endSubscription: false },
      {
        liveSubscriptions: async () => [],
        deleteCustomer: async () => void order.push("stripe"),
      },
    );
    expect(order).toEqual(["stripe"]);
    expect(calls).toHaveLength(2);

    calls.length = 0;
    await expect(
      deleteAccount(
        identity,
        { endSubscription: false },
        {
          liveSubscriptions: async () => [],
          deleteCustomer: async () => {
            throw new Error("stripe down");
          },
        },
      ),
    ).rejects.toThrow("stripe down");
    // Nothing was deleted in the database.
    expect(calls).toHaveLength(0);
  });
});
