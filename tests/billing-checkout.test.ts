import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

// Checkout: § 19 UStG (Kleinunternehmer) -- no Stripe Tax by default, the
// tax note on the Checkout page and as the customer's invoice footer. Stripe
// is never called: the client is a recorder.

const holder = vi.hoisted(() => ({
  customer: null as string | null,
  calls: [] as { method: string; args: unknown[] }[],
}));

vi.hoisted(() => {
  process.env.STRIPE_SECRET_KEY = "dummy-stripe-key-for-tests";
  process.env.STRIPE_PRICE_PRO = "price_test_pro";
  process.env.STRIPE_PRICE_DEVELOPER = "price_test_developer";
  process.env.STRIPE_PRICE_ULTRA_100 = "price_test_ultra_100";
  process.env.STRIPE_PRICE_ULTRA_200 = "price_test_ultra_200";
});

vi.mock("../src/lib/product/api", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../src/lib/product/api")>();
  return {
    ...actual,
    guardWrite: async (request: Request) => ({
      ok: true,
      body: await request.json(),
      identity: { userId: "00000000-0000-4000-8000-000000000001" },
    }),
  };
});

vi.mock("../src/lib/product/session", () => ({
  loadProductSession: async () => ({
    user: { email: "user@example.test", name: "Test User" },
  }),
}));

vi.mock("../src/lib/billing/store", () => ({
  customerIdFor: async () => holder.customer,
  saveCustomer: async (_userId: string, customer: string) => {
    holder.customer = customer;
  },
}));

vi.mock("../src/lib/billing/stripe", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../src/lib/billing/stripe")>();
  const record =
    (method: string, result: unknown) =>
    async (...args: unknown[]) => {
      holder.calls.push({ method, args });
      return result;
    };
  return {
    ...actual,
    stripe: () => ({
      customers: {
        create: record("customers.create", { id: "cus_test_1" }),
        update: record("customers.update", { id: "cus_test_1" }),
      },
      checkout: {
        sessions: {
          create: record("checkout.sessions.create", {
            url: "https://checkout.stripe.test/s",
          }),
        },
      },
    }),
  };
});

const { POST } = await import("../src/app/api/billing/checkout/route");
const NOTE = "Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.";

const checkout = () =>
  POST(
    new Request("https://osirus.test/api/billing/checkout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ plan: "pro" }),
    }),
  );
const call = (method: string) =>
  holder.calls.find((entry) => entry.method === method)?.args[0] as
    Record<string, unknown> | undefined;

beforeEach(() => {
  holder.customer = null;
  holder.calls = [];
});

afterAll(() => {
  for (const key of [
    "STRIPE_SECRET_KEY",
    "STRIPE_PRICE_PRO",
    "STRIPE_PRICE_DEVELOPER",
    "STRIPE_PRICE_ULTRA_100",
    "STRIPE_PRICE_ULTRA_200",
  ])
    delete process.env[key];
});

describe("billing checkout (§ 19 UStG)", () => {
  it("creates a subscription checkout without Stripe Tax and with the § 19 note", async () => {
    const response = await checkout();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      url: "https://checkout.stripe.test/s",
    });
    expect(call("customers.create")).toMatchObject({
      invoice_settings: { footer: NOTE },
    });
    const session = call("checkout.sessions.create")!;
    expect(session).toMatchObject({
      mode: "subscription",
      currency: "eur",
      customer: "cus_test_1",
      line_items: [{ price: "price_test_pro", quantity: 1 }],
      automatic_tax: { enabled: false },
      custom_text: { submit: { message: NOTE } },
    });
    expect(JSON.stringify(holder.calls)).not.toMatch(/MwSt|inkl/i);
  });

  it("adds the invoice footer to an existing customer", async () => {
    holder.customer = "cus_existing";
    expect((await checkout()).status).toBe(200);
    expect(call("customers.create")).toBeUndefined();
    const update = holder.calls.find((c) => c.method === "customers.update");
    expect(update?.args).toEqual([
      "cus_existing",
      { invoice_settings: { footer: NOTE } },
    ]);
    expect(call("checkout.sessions.create")).toMatchObject({
      customer: "cus_existing",
    });
  });
});
