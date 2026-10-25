import { z } from "zod";
import Stripe from "stripe";
import { loadProductSession } from "@/lib/product/session";
import { queryAs } from "@/lib/db/client";
import { json } from "@/lib/product/api";

const PLAN_PRICES: Record<string, string> = {
  pro: process.env.STRIPE_PRICE_PRO ?? "price_pro",
  developer: process.env.STRIPE_PRICE_DEVELOPER ?? "price_developer",
  "ultra-100": process.env.STRIPE_PRICE_ULTRA_100 ?? "price_ultra_100",
  "ultra-200": process.env.STRIPE_PRICE_ULTRA_200 ?? "price_ultra_200",
};

function getStripe(): Stripe | null {
  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) return null;
  return new Stripe(secret, { apiVersion: "2026-09-30.endive" });
}

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const schema = z.object({
  plan: z.enum(["pro", "developer", "ultra-100", "ultra-200"]),
});

export async function POST(request: Request) {
  const stripe = getStripe();
  if (!stripe) {
    return json(
      { error: "billing_not_configured", message: "Stripe is not configured" },
      503,
    );
  }

  const session = await loadProductSession();
  if (!session) {
    return json({ error: "unauthorized" }, 401);
  }

  const body = (await request.json().catch(() => null)) as
    | { plan?: string }
    | null;
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return json({ error: "invalid_request" }, 400);
  }

  const plan = parsed.data.plan;
  const priceId = PLAN_PRICES[plan];
  if (!priceId || priceId.startsWith("price_")) {
    return json(
      { error: "plan_not_configured", message: "Plan pricing is not configured" },
      503,
    );
  }

  const [customer] = await queryAs<{ stripe_customer_id: string | null }>(
    session.identity.userId,
    `select stripe_customer_id from osirus.workspaces where id = $1::uuid`,
    [session.identity.workspaceId],
  ).catch(() => []);

  let customerId = customer?.stripe_customer_id ?? null;

  if (!customerId) {
    const created = await stripe.customers.create({
      email: session.user.email ?? undefined,
      name: session.user.name ?? undefined,
      metadata: {
        workspace_id: session.identity.workspaceId,
        user_id: session.identity.userId,
      },
    });
    customerId = created.id;
    await queryAs(
      session.identity.userId,
      `update osirus.workspaces set stripe_customer_id = $1 where id = $2::uuid`,
      [customerId, session.identity.workspaceId],
    ).catch(() => undefined);
  }

  const origin = new URL(request.url).origin;
  const checkoutSession = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: "subscription",
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${origin}/app/settings?checkout=success`,
    cancel_url: `${origin}/app/settings?checkout=cancelled`,
    metadata: {
      workspace_id: session.identity.workspaceId,
      plan,
    },
    allow_promotion_codes: true,
    billing_address_collection: "required",
    tax_id_collection: { enabled: true },
  });

  return json({ url: checkoutSession.url });
}