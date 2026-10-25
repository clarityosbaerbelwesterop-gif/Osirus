import Stripe from "stripe";
import { querySystem } from "@/lib/db/client";
import { json } from "@/lib/product/api";

function getStripe(): Stripe | null {
  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) return null;
  return new Stripe(secret, { apiVersion: "2026-09-30.endive" });
}

function getWebhookSecret(): string | null {
  return process.env.STRIPE_WEBHOOK_SECRET ?? null;
}

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const stripe = getStripe();
  const webhookSecret = getWebhookSecret();

  if (!stripe || !webhookSecret) {
    return json(
      { error: "webhook_not_configured" },
      503,
    );
  }

  const body = await request.text();
  const signature = request.headers.get("stripe-signature");

  if (!signature) {
    return json({ error: "missing_signature" }, 400);
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
  } catch (error) {
    console.error("Stripe webhook signature verification failed:", error);
    return json({ error: "invalid_signature" }, 400);
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.mode === "subscription" && session.subscription) {
          await handleSubscriptionCreated(
            session.customer as string,
            session.subscription as string,
            session.metadata?.workspace_id ?? "",
            session.metadata?.plan ?? "",
          );
        }
        break;
      }

      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const subscription = event.data.object as Stripe.Subscription;
        const currentPeriodEnd = subscription.items.data[0]?.current_period_end ?? 0;
        await handleSubscriptionUpdated(
          subscription.customer as string,
          subscription.id,
          subscription.status,
          subscription.items.data[0]?.price.id ?? "",
          currentPeriodEnd,
          subscription.cancel_at_period_end,
        );
        break;
      }

      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        await handleSubscriptionDeleted(
          subscription.customer as string,
          subscription.id,
        );
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        await handlePaymentFailed(invoice.customer as string);
        break;
      }

      default:
        console.log(`Unhandled Stripe event type: ${event.type}`);
    }
  } catch (error) {
    console.error("Stripe webhook handler error:", error);
    return json({ error: "webhook_handler_failed" }, 500);
  }

  return json({ received: true });
}

async function handleSubscriptionCreated(
  customerId: string,
  subscriptionId: string,
  workspaceId: string,
  plan: string,
) {
  await querySystem(
    `update osirus.workspaces
     set stripe_customer_id = $1,
         stripe_subscription_id = $2,
         stripe_plan = $3,
         stripe_status = 'active',
         stripe_current_period_end = to_timestamp($4)
     where stripe_customer_id = $1`,
    [customerId, subscriptionId, plan, 0],
  ).catch(() => undefined);
}

async function handleSubscriptionUpdated(
  customerId: string,
  subscriptionId: string,
  status: string,
  priceId: string,
  currentPeriodEnd: number,
  cancelAtPeriodEnd: boolean,
) {
  let plan = "unknown";
  if (priceId === process.env.STRIPE_PRICE_PRO) plan = "pro";
  else if (priceId === process.env.STRIPE_PRICE_DEVELOPER) plan = "developer";
  else if (priceId === process.env.STRIPE_PRICE_ULTRA_100) plan = "ultra-100";
  else if (priceId === process.env.STRIPE_PRICE_ULTRA_200) plan = "ultra-200";

  await querySystem(
    `update osirus.workspaces
     set stripe_subscription_id = $1,
         stripe_plan = $2,
         stripe_status = $3,
         stripe_current_period_end = to_timestamp($4),
         stripe_cancel_at_period_end = $5
     where stripe_customer_id = $6`,
    [subscriptionId, plan, status, currentPeriodEnd, cancelAtPeriodEnd, customerId],
  ).catch(() => undefined);
}

async function handleSubscriptionDeleted(
  customerId: string,
  subscriptionId: string,
) {
  await querySystem(
    `update osirus.workspaces
     set stripe_subscription_id = null,
         stripe_plan = null,
         stripe_status = 'canceled',
         stripe_current_period_end = null,
         stripe_cancel_at_period_end = false
     where stripe_customer_id = $1 and stripe_subscription_id = $2`,
    [customerId, subscriptionId],
  ).catch(() => undefined);
}

async function handlePaymentFailed(customerId: string) {
  await querySystem(
    `update osirus.workspaces
     set stripe_status = 'past_due'
     where stripe_customer_id = $1`,
    [customerId],
  ).catch(() => undefined);
}