import { randomUUID } from "node:crypto";
import Stripe from "stripe";
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

// Stripe webhook: signature verification, subscription sync per user,
// idempotency, ordering, unknown prices, and the migration's RLS -- against
// the real migrations in PGlite. Stripe itself is never called: the
// subscription "retrieve" is a stub and signatures are made locally with the
// SDK's test helper.

const WEBHOOK_SECRET = "dummy-webhook-secret-for-tests";
const PRICES = {
  STRIPE_PRICE_PRO: "price_test_pro",
  STRIPE_PRICE_DEVELOPER: "price_test_developer",
  STRIPE_PRICE_ULTRA_100: "price_test_ultra_100",
  STRIPE_PRICE_ULTRA_200: "price_test_ultra_200",
};

const holder = vi.hoisted(() => ({
  db: null as TestDatabase | null,
  subscriptions: new Map<string, unknown>(),
}));

vi.hoisted(() => {
  process.env.STRIPE_SECRET_KEY = "dummy-stripe-key-for-tests";
  process.env.STRIPE_WEBHOOK_SECRET = "dummy-webhook-secret-for-tests";
  process.env.STRIPE_PRICE_PRO = "price_test_pro";
  process.env.STRIPE_PRICE_DEVELOPER = "price_test_developer";
  process.env.STRIPE_PRICE_ULTRA_100 = "price_test_ultra_100";
  process.env.STRIPE_PRICE_ULTRA_200 = "price_test_ultra_200";
});

vi.mock("../src/lib/db/client", () => ({
  queryAs: (userId: string, text: string, params?: unknown[]) =>
    holder.db!.queryAs(userId, text, params),
  querySystem: (text: string, params?: unknown[]) =>
    holder.db!.querySystem(text, params),
  db: () => {
    throw new Error("tests never reach Neon");
  },
}));

vi.mock("../src/lib/billing/stripe", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../src/lib/billing/stripe")>();
  const real = new Stripe("dummy-stripe-key-for-tests");
  return {
    ...actual,
    stripe: () => ({
      webhooks: real.webhooks,
      subscriptions: {
        retrieve: async (id: string) => {
          const found = holder.subscriptions.get(id);
          if (!found) throw new Error(`no such subscription ${id}`);
          return found;
        },
      },
    }),
  };
});

const { POST } = await import("../src/app/api/billing/webhook/route");
const { handleStripeEvent } = await import("../src/lib/billing/webhook");
const { planForPrice } = await import("../src/lib/billing/stripe");
const { quotaStatusFor } = await import("../src/lib/billing/enforce");
const store = await import("../src/lib/billing/store");

const signer = new Stripe("dummy-stripe-key-for-tests");
let db: TestDatabase;
let tenant: TestIdentity;
let created = 1_790_000_000;

beforeAll(async () => {
  db = await createTestDatabase();
  holder.db = db;
}, 120_000);

afterAll(async () => {
  await db?.close();
  // Billing env must not leak into other test files sharing this worker.
  for (const name of [
    "STRIPE_SECRET_KEY",
    "STRIPE_WEBHOOK_SECRET",
    ...Object.keys(PRICES),
  ])
    delete process.env[name];
});

beforeEach(async () => {
  tenant = await db.seedTenant("billing");
  holder.subscriptions.clear();
});

function subscription(input: {
  id: string;
  customer: string;
  price: string;
  status: string;
  userId?: string;
  cancelAtPeriodEnd?: boolean;
}) {
  return {
    id: input.id,
    object: "subscription",
    customer: input.customer,
    status: input.status,
    cancel_at_period_end: input.cancelAtPeriodEnd ?? false,
    metadata: input.userId ? { userId: input.userId } : {},
    items: {
      object: "list",
      data: [
        {
          id: `si_${input.id}`,
          price: { id: input.price },
          current_period_end: 1_800_000_000,
        },
      ],
    },
  };
}

function event(type: string, object: unknown, at = ++created) {
  return {
    id: `evt_${randomUUID().replaceAll("-", "")}`,
    object: "event",
    type,
    created: at,
    data: { object },
  };
}

async function deliver(body: unknown, secret = WEBHOOK_SECRET) {
  const payload = JSON.stringify(body);
  const header = signer.webhooks.generateTestHeaderString({ payload, secret });
  return POST(
    new Request("https://osirus.test/api/billing/webhook", {
      method: "POST",
      headers: {
        "stripe-signature": header,
        "content-type": "application/json",
      },
      body: payload,
    }),
  );
}

async function rowsFor(userId: string) {
  return db.raw<{
    plan: string | null;
    status: string;
    price_id: string;
    cancel_at_period_end: boolean;
  }>(
    "select plan, status, price_id, cancel_at_period_end from osirus.billing_subscriptions where user_id = $1",
    [userId],
  );
}

describe("stripe webhook route", () => {
  it("rejects a missing or wrong signature", async () => {
    const body = event("customer.subscription.updated", {});
    const unsigned = await POST(
      new Request("https://osirus.test/api/billing/webhook", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    );
    expect(unsigned.status).toBe(400);
    const forged = await deliver(body, "dummy-wrong-secret");
    expect(forged.status).toBe(400);
    expect(await forged.json()).toEqual({ error: "invalid_signature" });
  });

  it("checkout.session.completed links the customer and activates the plan", async () => {
    holder.subscriptions.set(
      "sub_checkout",
      subscription({
        id: "sub_checkout",
        customer: "cus_checkout",
        price: PRICES.STRIPE_PRICE_DEVELOPER,
        status: "active",
      }),
    );
    const response = await deliver(
      event("checkout.session.completed", {
        id: "cs_test_1",
        object: "checkout.session",
        mode: "subscription",
        customer: "cus_checkout",
        subscription: "sub_checkout",
        client_reference_id: tenant.userId,
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      received: true,
      handled: true,
      plan: "developer",
    });
    expect(await rowsFor(tenant.userId)).toEqual([
      expect.objectContaining({ plan: "developer", status: "active" }),
    ]);
    expect(await store.customerIdFor(tenant.userId)).toBe("cus_checkout");

    const quota = await quotaStatusFor(tenant.userId);
    expect(quota.plan).toBe("developer");
    expect(quota.allowed).toBe(true);
  });

  it("is idempotent: the same event twice is processed once", async () => {
    holder.subscriptions.set(
      "sub_dup",
      subscription({
        id: "sub_dup",
        customer: "cus_dup",
        price: PRICES.STRIPE_PRICE_PRO,
        status: "active",
        userId: tenant.userId,
      }),
    );
    const body = event("customer.subscription.created", {
      id: "sub_dup",
      customer: "cus_dup",
      metadata: { userId: tenant.userId },
    });
    expect(await (await deliver(body)).json()).toMatchObject({ handled: true });
    expect(await (await deliver(body)).json()).toMatchObject({
      handled: false,
      reason: "duplicate_event",
    });
  });

  it("syncs upgrades, cancellation and deletion; an old event never wins", async () => {
    const base = {
      id: "sub_life",
      customer: "cus_life",
      userId: tenant.userId,
    };
    holder.subscriptions.set(
      "sub_life",
      subscription({
        ...base,
        price: PRICES.STRIPE_PRICE_PRO,
        status: "active",
      }),
    );
    await deliver(
      event("customer.subscription.created", {
        id: "sub_life",
        customer: "cus_life",
        metadata: { userId: tenant.userId },
      }),
    );
    expect((await rowsFor(tenant.userId))[0]!.plan).toBe("pro");

    holder.subscriptions.set(
      "sub_life",
      subscription({
        ...base,
        price: PRICES.STRIPE_PRICE_ULTRA_200,
        status: "active",
        cancelAtPeriodEnd: true,
      }),
    );
    const newer = ++created + 100;
    await deliver(
      event(
        "customer.subscription.updated",
        { id: "sub_life", customer: "cus_life" },
        newer,
      ),
    );
    expect((await rowsFor(tenant.userId))[0]).toMatchObject({
      plan: "ultra_200",
      cancel_at_period_end: true,
    });

    // A late, older event must not overwrite the newer state.
    holder.subscriptions.set(
      "sub_life",
      subscription({
        ...base,
        price: PRICES.STRIPE_PRICE_PRO,
        status: "active",
      }),
    );
    await deliver(
      event(
        "customer.subscription.updated",
        { id: "sub_life", customer: "cus_life" },
        newer - 50,
      ),
    );
    expect((await rowsFor(tenant.userId))[0]!.plan).toBe("ultra_200");

    holder.subscriptions.set(
      "sub_life",
      subscription({
        ...base,
        price: PRICES.STRIPE_PRICE_ULTRA_200,
        status: "canceled",
      }),
    );
    await deliver(
      event(
        "customer.subscription.deleted",
        { id: "sub_life", customer: "cus_life" },
        newer + 10,
      ),
    );
    expect((await rowsFor(tenant.userId))[0]!.status).toBe("canceled");
    const quota = await quotaStatusFor(tenant.userId);
    expect(quota.allowed).toBe(false);
    expect(quota.reason).toBe("no_subscription");
  });

  it("stores an unknown price without granting a plan", async () => {
    holder.subscriptions.set(
      "sub_odd",
      subscription({
        id: "sub_odd",
        customer: "cus_odd",
        price: "price_other",
        status: "active",
        userId: tenant.userId,
      }),
    );
    const result = await (
      await deliver(
        event("customer.subscription.created", {
          id: "sub_odd",
          customer: "cus_odd",
          metadata: { userId: tenant.userId },
        }),
      )
    ).json();
    expect(result).toMatchObject({ handled: true, plan: null });
    expect((await quotaStatusFor(tenant.userId)).reason).toBe(
      "no_subscription",
    );
  });

  it("ignores events for unknown users and unrelated event types", async () => {
    holder.subscriptions.set(
      "sub_ghost",
      subscription({
        id: "sub_ghost",
        customer: "cus_ghost",
        price: PRICES.STRIPE_PRICE_PRO,
        status: "active",
        userId: randomUUID(),
      }),
    );
    expect(
      await (
        await deliver(
          event("customer.subscription.created", {
            id: "sub_ghost",
            customer: "cus_ghost",
          }),
        )
      ).json(),
    ).toMatchObject({ handled: false, reason: "unknown_user" });
    expect(
      await (await deliver(event("invoice.paid", { id: "in_1" }))).json(),
    ).toMatchObject({ handled: false, reason: "ignored_event_type" });
  });

  it("releases the event claim when processing fails so Stripe can retry", async () => {
    const body = event("customer.subscription.updated", {
      id: "sub_missing",
      customer: "cus_missing",
    });
    const failed = await deliver(body);
    expect(failed.status).toBe(500);
    holder.subscriptions.set(
      "sub_missing",
      subscription({
        id: "sub_missing",
        customer: "cus_missing",
        price: PRICES.STRIPE_PRICE_PRO,
        status: "active",
        userId: tenant.userId,
      }),
    );
    expect(await (await deliver(body)).json()).toMatchObject({
      handled: true,
      plan: "pro",
    });
  });
});

describe("billing tables and usage", () => {
  it("a user reads only their own billing rows and cannot write them", async () => {
    const other = await db.seedTenant("other");
    await store.saveCustomer(tenant.userId, `cus_${tenant.userId.slice(0, 8)}`);
    await store.saveCustomer(other.userId, `cus_${other.userId.slice(0, 8)}`);
    const own = await db.queryAs<{ user_id: string }>(
      tenant.userId,
      "select user_id from osirus.billing_customers",
    );
    expect(own.map((r) => r.user_id)).toEqual([tenant.userId]);
    await expect(
      db.queryAs(
        tenant.userId,
        "insert into osirus.billing_subscriptions (stripe_subscription_id, user_id, stripe_customer_id, plan, status) values ('sub_self', $1, 'cus_self', 'ultra_200', 'active')",
        [tenant.userId],
      ),
    ).rejects.toThrow();
    await expect(
      db.queryAs(tenant.userId, "select id from osirus.stripe_events"),
    ).resolves.toEqual([]);
  });

  it("charges the run requester's model calls against their windows", async () => {
    holder.subscriptions.set(
      "sub_usage",
      subscription({
        id: "sub_usage",
        customer: "cus_usage",
        price: PRICES.STRIPE_PRICE_PRO,
        status: "active",
        userId: tenant.userId,
      }),
    );
    await handleStripeEvent(
      event("customer.subscription.created", {
        id: "sub_usage",
        customer: "cus_usage",
      }) as unknown as Stripe.Event,
      {
        retrieveSubscription: async (id) =>
          holder.subscriptions.get(id) as Stripe.Subscription,
        planForPrice: (id) => planForPrice(id),
        claimEvent: store.claimEvent,
        releaseEvent: store.releaseEvent,
        userIdForCustomer: store.userIdForCustomer,
        userExists: store.userExists,
        saveCustomer: store.saveCustomer,
        upsertSubscription: store.upsertSubscription,
      },
    );
    const { runId, stageId } = await db.seedRun(tenant);
    // 1.2 USD logged > Pro's 1.01 USD 5-hour budget (no conversion).
    await db.raw(
      `insert into osirus.model_calls (organization_id, workspace_id, run_id, stage_id, provider, model, logical_role, status, estimated_cost_usd, created_at)
       values ($1, $2, $3, $4, 'unorouter', 'm', 'FAST', 'completed', 1.2, now() - interval '1 hour')`,
      [tenant.organizationId, tenant.workspaceId, runId, stageId],
    );
    const status = await quotaStatusFor(tenant.userId);
    expect(status.plan).toBe("pro");
    expect(status.allowed).toBe(false);
    expect(status.reason).toBe("quota_exhausted");
    expect(status.retryAfterMs).toBeGreaterThan(3.9 * 3_600_000);
    expect(status.retryAfterMs).toBeLessThanOrEqual(4 * 3_600_000);
  });
});
