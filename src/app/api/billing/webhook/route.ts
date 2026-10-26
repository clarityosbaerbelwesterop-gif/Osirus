import type Stripe from "stripe";
import { env } from "@/lib/env";
import {
  claimEvent,
  releaseEvent,
  saveCustomer,
  upsertSubscription,
  userExists,
  userIdForCustomer,
} from "@/lib/billing/store";
import { planForPrice, stripe } from "@/lib/billing/stripe";
import { handleStripeEvent } from "@/lib/billing/webhook";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BYTES = 512 * 1024;

/**
 * Stripe webhook. Unauthenticated by design; the Stripe-Signature header
 * checked against STRIPE_WEBHOOK_SECRET is the authentication.
 */
export async function POST(request: Request) {
  // The dashboard endpoint's secret and the one scripts/stripe-setup.mjs
  // created for its own endpoint; a delivery signed with either is genuine.
  const secrets = [
    env.STRIPE_WEBHOOK_SECRET,
    env.STRIPE_WEBHOOK_SECRET_MANAGED,
  ].filter((secret): secret is string => Boolean(secret));
  if (!env.STRIPE_SECRET_KEY || secrets.length === 0)
    return Response.json({ error: "billing_not_configured" }, { status: 503 });
  const signature = request.headers.get("stripe-signature");
  if (!signature)
    return Response.json({ error: "missing_signature" }, { status: 400 });
  const payload = await request.text();
  if (payload.length > MAX_BYTES)
    return Response.json({ error: "payload_too_large" }, { status: 413 });

  const client = stripe();
  let event: Stripe.Event | null = null;
  for (const secret of secrets) {
    try {
      event = client.webhooks.constructEvent(payload, signature, secret);
      break;
    } catch {
      // try the next secret
    }
  }
  if (!event)
    return Response.json({ error: "invalid_signature" }, { status: 400 });

  try {
    const result = await handleStripeEvent(event, {
      retrieveSubscription: (id) => client.subscriptions.retrieve(id),
      planForPrice: (priceId) => planForPrice(priceId),
      claimEvent,
      releaseEvent,
      userIdForCustomer,
      userExists,
      saveCustomer,
      upsertSubscription,
      log: (message, data) => console.warn(message, data),
    });
    return Response.json({ received: true, ...result });
  } catch (error) {
    console.error("stripe webhook failed", {
      eventId: event.id,
      type: event.type,
      error: error instanceof Error ? error.message : "unknown",
    });
    // 500 makes Stripe retry the delivery.
    return Response.json({ error: "processing_failed" }, { status: 500 });
  }
}
