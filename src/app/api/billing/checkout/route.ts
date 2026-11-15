import { z } from "zod";
import { env } from "@/lib/env";
import { BILLING_CONFIG, PAID_PLANS } from "@/lib/billing/config";
import { customerIdFor, saveCustomer } from "@/lib/billing/store";
import {
  billingConfigured,
  integrationIdentifier,
  resolvePriceId,
  stripe,
} from "@/lib/billing/stripe";
import { guardWrite, json } from "@/lib/product/api";
import { loadProductSession } from "@/lib/product/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const schema = z.object({ plan: z.enum(PAID_PLANS) });

/** Subscription states that still bill or can bill again. */
const LIVE_STATUSES = new Set([
  "active",
  "trialing",
  "past_due",
  "unpaid",
  "incomplete",
  "paused",
]);

function origin(request: Request) {
  return env.OSIRUS_PUBLIC_URL ?? new URL(request.url).origin;
}

/**
 * Starts a Stripe Checkout Session (subscription mode, EUR) for one of the
 * four plans and returns its URL. Stripe Tax stays off unless
 * BILLING_CONFIG.stripeAutomaticTax is on (§ 19 UStG: no VAT charged); the
 * § 19 note goes on the Checkout page and the customer's invoice footer. The plan is applied only by the
 * webhook once Stripe confirms the subscription.
 */
export async function POST(request: Request) {
  const guard = await guardWrite(request, {
    schema,
    route: "billing.checkout",
    limit: 10,
    maxBytes: 1024,
  });
  if (!guard.ok) return guard.response;
  if (!billingConfigured())
    return json({ error: "billing_not_configured" }, 503);
  const price = await resolvePriceId(guard.body.plan);
  if (!price) return json({ error: "plan_not_configured" }, 503);

  const userId = guard.identity.userId;
  const session = await loadProductSession();
  const existingCustomer = await customerIdFor(userId);
  const client = stripe();
  const taxNote = BILLING_CONFIG.taxNote;
  let customer = existingCustomer;
  if (!customer) {
    // One Stripe customer per Osirus user, created up front so the webhook
    // can always map it back to the user.
    const created = await client.customers.create(
      {
        email: session?.user.email ?? undefined,
        name: session?.user.name ?? undefined,
        metadata: { userId },
        ...(taxNote ? { invoice_settings: { footer: taxNote } } : {}),
      },
      { idempotencyKey: `osirus-customer-${userId}` },
    );
    customer = created.id;
    await saveCustomer(userId, customer);
  } else if (taxNote) {
    // Customers created before the note existed get it too. Only write when
    // the footer actually differs, so a checkout is not a customer update.
    const current = await client.customers.retrieve(customer);
    const deleted = "deleted" in current && current.deleted === true;
    if (!deleted && current.invoice_settings?.footer !== taxNote)
      await client.customers.update(customer, {
        invoice_settings: { footer: taxNote },
      });
  }

  const earlier = existingCustomer
    ? (
        await client.subscriptions.list({
          customer: existingCustomer,
          status: "all",
          limit: 20,
        })
      ).data
    : [];
  // A second checkout next to a running subscription starts a second
  // subscription, and both bill. Upgrades and downgrades go through the
  // portal, which changes the one subscription.
  if (earlier.some((subscription) => LIVE_STATUSES.has(subscription.status)))
    return json(
      {
        error: "subscription_exists",
        message:
          "Du hast schon ein Abo. Plan wechseln geht über „Abo verwalten“.",
      },
      409,
    );
  // Pro starts with a free week, once per person: only a customer without
  // any earlier subscription (in any state) gets it.
  const firstSubscription = earlier.length === 0;
  const trialDays =
    guard.body.plan === "pro" && firstSubscription
      ? BILLING_CONFIG.proTrialDays
      : 0;

  const base = origin(request);
  const checkout = await client.checkout.sessions.create({
    mode: "subscription",
    customer,
    client_reference_id: userId,
    line_items: [{ price, quantity: 1 }],
    currency: "eur",
    automatic_tax: { enabled: BILLING_CONFIG.stripeAutomaticTax },
    ...(taxNote ? { custom_text: { submit: { message: taxNote } } } : {}),
    billing_address_collection: "required",
    customer_update: { address: "auto", name: "auto" },
    tax_id_collection: { enabled: true },
    subscription_data: {
      metadata: { userId, plan: guard.body.plan },
      ...(trialDays ? { trial_period_days: trialDays } : {}),
    },
    metadata: { userId, plan: guard.body.plan },
    success_url: `${base}/app?billing=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${base}/app?billing=cancelled`,
    integration_identifier: integrationIdentifier(),
  });
  if (!checkout.url) return json({ error: "checkout_unavailable" }, 502);
  return json({ url: checkout.url, trialDays });
}
