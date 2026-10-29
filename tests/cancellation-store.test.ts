import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  createTestDatabase,
  type TestDatabase,
  type TestIdentity,
} from "./helpers/pglite";

// The cancellation page against a real Postgres with every migration and
// forced row-level security: the declaration is stored as received, matched
// to the account, the subscription is set to end in Stripe (mocked), and the
// operator gets an inbox entry.

const holder: { db?: TestDatabase } = {};
const stripeUpdate = vi.fn();

vi.mock("../src/lib/db/client", () => ({
  queryAs: (userId: string, text: string, params?: unknown[]) =>
    holder.db!.queryAs(userId, text, params),
  querySystem: (text: string, params?: unknown[]) =>
    holder.db!.querySystem(text, params),
  db: () => {
    throw new Error("tests never reach Neon");
  },
}));

vi.mock("../src/lib/billing/stripe", () => ({
  billingConfigured: () => true,
  stripe: () => ({
    subscriptions: { update: stripeUpdate },
    customers: { list: vi.fn(async () => ({ data: [] })) },
  }),
}));

vi.mock("../src/lib/mail/send", () => ({
  sendMail: vi.fn(async () => ({ sent: false, reason: "not_configured" })),
  mailConfigured: () => false,
}));

const { processCancellation } = await import("../src/lib/cancellation/process");
const { cancellationDeps } = await import("../src/lib/cancellation/store");
const { cancellationSchema } = await import("../src/lib/cancellation/rules");

const OPERATOR = {
  name: "ClarityCompassAI",
  owner: "Bärbel Westerop",
  street: "Drinhausstraße 22",
  city: "47447 Moers-Kapellen",
  email: "betrieb@example.test",
};
const PERIOD_END = new Date("2026-11-20T09:00:00Z");

let operator: TestIdentity;
let customer: TestIdentity;
let stranger: TestIdentity;

const deps = () =>
  cancellationDeps({
    operator: OPERATOR,
    pageUrl: "https://osirus-ai.vercel.app/kuendigen",
  });

const declaration = (overrides: Record<string, unknown> = {}) =>
  cancellationSchema.parse({
    name: "Erika Mustermann",
    email: "erika@example.test",
    contract: "subscription",
    kind: "ordinary",
    timing: "earliest",
    ...overrides,
  });

beforeAll(async () => {
  holder.db = await createTestDatabase();
  operator = await holder.db.seedTenant("betrieb");
  customer = await holder.db.seedTenant("erika");
  stranger = await holder.db.seedTenant("fremd");
  await holder.db.raw("update osirus.users set email = $2 where id = $1", [
    operator.userId,
    OPERATOR.email,
  ]);
  await holder.db.raw("update osirus.users set email = $2 where id = $1", [
    customer.userId,
    "Erika@Example.test",
  ]);
  await holder.db.raw(
    `insert into osirus.billing_subscriptions
       (stripe_subscription_id, user_id, stripe_customer_id, plan, status,
        current_period_end, cancel_at_period_end)
     values ('sub_erika', $1, 'cus_erika', 'pro', 'active', $2, false)`,
    [customer.userId, PERIOD_END.toISOString()],
  );
}, 120_000);

afterAll(async () => {
  await holder.db?.close();
});

describe("cancellation page against Postgres", () => {
  it("stores the declaration, ends the subscription and notifies the operator", async () => {
    stripeUpdate.mockResolvedValueOnce({
      cancel_at: null,
      cancel_at_period_end: true,
      items: {
        data: [{ current_period_end: Math.floor(PERIOD_END.getTime() / 1000) }],
      },
    });
    const receipt = await processCancellation(
      declaration(),
      { signedInUserId: null, signedInEmail: null, networkHash: "abc" },
      deps(),
    );
    expect(stripeUpdate).toHaveBeenCalledWith("sub_erika", {
      cancel_at_period_end: true,
      metadata: { osirus_cancellation: "kuendigen" },
    });
    const [row] = await holder.db!.raw<{
      reference: string;
      user_id: string;
      stripe_subscription_id: string;
      status: string;
      effective_at: Date;
      confirmation_sent_at: Date | null;
      network_hash: string;
      signed_in: boolean;
    }>("select * from osirus.contract_cancellations where reference = $1", [
      receipt.reference,
    ]);
    expect(row).toMatchObject({
      user_id: customer.userId,
      stripe_subscription_id: "sub_erika",
      status: "scheduled",
      confirmation_sent_at: null,
      network_hash: "abc",
      signed_in: false,
    });
    expect(new Date(row!.effective_at).toISOString()).toBe(
      PERIOD_END.toISOString(),
    );
    expect(receipt.mailSent).toBe(false);

    const notes = await holder.db!.raw<{
      user_id: string;
      kind: string;
      title: string;
      body: string;
    }>(
      "select user_id, kind, title, body from osirus.notifications where kind = 'cancellation_received'",
    );
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ user_id: operator.userId });
    expect(notes[0]!.title).toContain(receipt.reference);
    expect(notes[0]!.body).toContain("Keine E-Mail versandt");
  });

  it("keeps an unknown address as unmatched, linked to no account", async () => {
    const receipt = await processCancellation(
      declaration({
        email: "niemand@example.test",
        timing: "date",
        requestedEnd: "2099-01-31",
      }),
      { signedInUserId: null, signedInEmail: null, networkHash: null },
      deps(),
    );
    const [row] = await holder.db!.raw<{
      status: string;
      user_id: string | null;
      requested_end: Date | string;
      timing: string;
    }>(
      "select status, user_id, requested_end, timing from osirus.contract_cancellations where reference = $1",
      [receipt.reference],
    );
    expect(row).toMatchObject({
      status: "unmatched",
      user_id: null,
      timing: "date",
    });
  });

  it("lets a person read only the declarations linked to them, and nobody delete", async () => {
    const own = await holder.db!.queryAs<{ reference: string }>(
      customer.userId,
      "select reference from osirus.contract_cancellations",
    );
    expect(own).toHaveLength(1);
    const foreign = await holder.db!.queryAs<{ reference: string }>(
      stranger.userId,
      "select reference from osirus.contract_cancellations",
    );
    expect(foreign).toHaveLength(0);
    await expect(
      holder.db!.queryAs(
        customer.userId,
        `insert into osirus.contract_cancellations
           (reference, name, email, contract, kind, timing)
         values ('K-X', 'X', 'x@example.test', 'free', 'ordinary', 'earliest')`,
      ),
    ).rejects.toThrow();
    await expect(
      holder.db!.querySystem("delete from osirus.contract_cancellations"),
    ).rejects.toThrow();
  });

  it("rejects an extraordinary cancellation without reason at the database too", async () => {
    await expect(
      holder.db!.querySystem(
        `insert into osirus.contract_cancellations
           (reference, name, email, contract, kind, timing)
         values ('K-Y', 'Y', 'y@example.test', 'subscription', 'extraordinary', 'earliest')`,
      ),
    ).rejects.toThrow();
  });
});
