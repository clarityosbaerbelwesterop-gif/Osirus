import { env } from "@/lib/env";
import { customerIdFor } from "@/lib/billing/store";
import { billingConfigured, stripe } from "@/lib/billing/stripe";
import { guardAction, json } from "@/lib/product/api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Opens the Stripe Customer Portal (change plan, cancel, invoices). */
export async function POST(request: Request) {
  const guard = await guardAction(request, {
    route: "billing.portal",
    limit: 10,
  });
  if (!guard.ok) return guard.response;
  if (!billingConfigured())
    return json({ error: "billing_not_configured" }, 503);
  const customer = await customerIdFor(guard.identity.userId);
  if (!customer) return json({ error: "no_billing_account" }, 404);
  const base = env.OSIRUS_PUBLIC_URL ?? new URL(request.url).origin;
  const portal = await stripe().billingPortal.sessions.create({
    customer,
    return_url: `${base}/app`,
  });
  return json({ url: portal.url });
}
