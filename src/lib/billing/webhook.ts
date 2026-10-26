import type Stripe from "stripe";
import { BILLING_CONFIG, isPaidPlan, type PaidPlan } from "./config";

// Stripe webhook handling, kept free of I/O so it is testable: the route
// verifies the signature and passes the event plus the dependencies here.
//
// Every subscription-relevant event re-reads the subscription from Stripe
// rather than trusting the (possibly stale, possibly out-of-order) event
// payload, then upserts one row per subscription keyed to the Osirus user.

export type WebhookDeps = {
  retrieveSubscription(id: string): Promise<Stripe.Subscription>;
  planForPrice(priceId: string | null | undefined): PaidPlan | null;
  claimEvent(id: string, type: string): Promise<boolean>;
  releaseEvent(id: string): Promise<void>;
  userIdForCustomer(customerId: string): Promise<string | null>;
  userExists(userId: string): Promise<boolean>;
  saveCustomer(userId: string, customerId: string): Promise<void>;
  upsertSubscription(row: {
    subscriptionId: string;
    userId: string;
    customerId: string;
    plan: PaidPlan | null;
    priceId: string | null;
    status: string;
    currentPeriodEnd: Date | null;
    cancelAtPeriodEnd: boolean;
    eventCreated: Date;
  }): Promise<void>;
  log?(message: string, data?: Record<string, unknown>): void;
};

export type WebhookResult =
  | {
      handled: true;
      subscriptionId: string;
      status: string;
      plan: PaidPlan | null;
    }
  | { handled: false; reason: string };

const SUBSCRIPTION_EVENTS = new Set([
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "customer.subscription.paused",
  "customer.subscription.resumed",
]);

const CHECKOUT_EVENTS = new Set([
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
]);

export const HANDLED_EVENT_TYPES = [...CHECKOUT_EVENTS, ...SUBSCRIPTION_EVENTS];

const idOf = (value: string | { id: string } | null | undefined) =>
  typeof value === "string" ? value : (value?.id ?? null);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function candidateUserId(value: unknown) {
  return typeof value === "string" && UUID.test(value) ? value : null;
}

export async function handleStripeEvent(
  event: Stripe.Event,
  deps: WebhookDeps,
): Promise<WebhookResult> {
  const checkout = CHECKOUT_EVENTS.has(event.type);
  if (!checkout && !SUBSCRIPTION_EVENTS.has(event.type))
    return { handled: false, reason: "ignored_event_type" };

  if (!(await deps.claimEvent(event.id, event.type)))
    return { handled: false, reason: "duplicate_event" };

  try {
    let subscriptionId: string | null;
    let customerId: string | null;
    let userHint: string | null = null;

    if (checkout) {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.mode !== "subscription")
        return { handled: false, reason: "not_a_subscription_checkout" };
      subscriptionId = idOf(session.subscription);
      customerId = idOf(session.customer);
      userHint =
        candidateUserId(session.client_reference_id) ??
        candidateUserId(session.metadata?.userId);
    } else {
      const subscription = event.data.object as Stripe.Subscription;
      subscriptionId = subscription.id;
      customerId = idOf(subscription.customer);
      userHint = candidateUserId(subscription.metadata?.userId);
    }
    if (!subscriptionId || !customerId)
      return { handled: false, reason: "missing_subscription_or_customer" };

    // The current truth, not the event snapshot.
    const subscription = await deps.retrieveSubscription(subscriptionId);
    userHint ??= candidateUserId(subscription.metadata?.userId);

    let userId = await deps.userIdForCustomer(customerId);
    if (!userId && userHint && (await deps.userExists(userHint))) {
      userId = userHint;
      await deps.saveCustomer(userId, customerId);
    }
    if (!userId) {
      deps.log?.("stripe webhook: no Osirus user for customer", {
        eventId: event.id,
        customerId,
      });
      return { handled: false, reason: "unknown_user" };
    }

    const item = subscription.items.data[0];
    const priceId = item?.price?.id ?? null;
    let plan = deps.planForPrice(priceId);
    if (!plan) {
      const metaPlan =
        subscription.metadata?.plan ?? item?.price?.metadata?.osirus_plan;
      if (isPaidPlan(metaPlan)) {
        plan = metaPlan;
      }
    }
    if (!plan)
      deps.log?.("stripe webhook: price is not an Osirus plan", {
        eventId: event.id,
        priceId,
      });

    await deps.upsertSubscription({
      subscriptionId: subscription.id,
      userId,
      customerId,
      plan,
      priceId,
      status: subscription.status,
      currentPeriodEnd: item?.current_period_end
        ? new Date(item.current_period_end * 1000)
        : null,
      cancelAtPeriodEnd: Boolean(subscription.cancel_at_period_end),
      eventCreated: new Date(event.created * 1000),
    });
    return {
      handled: true,
      subscriptionId: subscription.id,
      status: subscription.status,
      plan:
        plan && BILLING_CONFIG.entitledStatuses.includes(subscription.status)
          ? plan
          : null,
    };
  } catch (error) {
    // Let Stripe retry: forget the claim so the retry is not a "duplicate".
    await deps.releaseEvent(event.id).catch(() => undefined);
    throw error;
  }
}
