// Makes Stripe ready for Osirus and proves it, without printing a secret:
//   1. the account: live or test, charges and payouts enabled
//   2. the four monthly EUR prices (lookup keys osirus_<plan>_monthly_eur)
//   3. the webhook endpoint at <public url>/api/billing/webhook with every
//      event Osirus handles; a missing one is created and its signing secret
//      goes to Vercel as STRIPE_WEBHOOK_SECRET_MANAGED (the webhook accepts
//      that and STRIPE_WEBHOOK_SECRET)
//   4. a Customer Portal configuration (plan change, cancel, invoices)
//   5. end to end: a signed test delivery to the live webhook must pass
//      the signature check with STRIPE_WEBHOOK_SECRET

import { appendFileSync } from "node:fs";
import Stripe from "stripe";
import {
  endpointChanges,
  keyMode,
  lookupKeyFor,
  pickEndpoint,
  PLANS,
  REQUIRED_EVENTS,
  stripeSignature,
  webhookUrl,
} from "./lib/stripe-setup.mjs";

const key = process.env.STRIPE_SECRET_KEY?.trim();
if (!key)
  throw new Error("STRIPE_SECRET_KEY must be configured in GitHub Actions");
const publicUrl =
  process.env.OSIRUS_PUBLIC_URL?.trim() || "https://osirus-ai.vercel.app";
const createWebhook = process.env.OSIRUS_STRIPE_CREATE_WEBHOOK !== "false";
const stripe = new Stripe(key, { appInfo: { name: "Osirus setup" } });

const summary = [];
const problems = [];
function report(line) {
  console.log(line);
  summary.push(`- ${line}`);
}

// 1. Account
const account = await stripe.accounts.retrieve();
report(
  `Account: ${keyMode(key)} mode, ${account.country ?? "?"}, ${account.default_currency?.toUpperCase() ?? "?"}; charges ${account.charges_enabled ? "enabled" : "NOT enabled"}, payouts ${account.payouts_enabled ? "enabled" : "NOT enabled"}`,
);
if (!account.charges_enabled)
  problems.push(
    "Stripe account cannot take payments yet (finish activation in the Stripe Dashboard).",
  );

// 2. Prices
const prices = {};
for (const plan of PLANS) {
  const lookup = lookupKeyFor(plan.plan);
  const found = await stripe.prices.list({
    lookup_keys: [lookup],
    active: true,
    limit: 1,
  });
  let price = found.data[0];
  if (!price) {
    const search = await stripe.products.search({
      query: `metadata['osirus_plan']:'${plan.plan}'`,
    });
    const product =
      search.data[0] ??
      (await stripe.products.create({
        name: `Osirus ${plan.label}`,
        metadata: { osirus_plan: plan.plan },
      }));
    price = await stripe.prices.create({
      product: product.id,
      currency: "eur",
      unit_amount: plan.eur * 100,
      recurring: { interval: "month" },
      tax_behavior: "inclusive",
      lookup_key: lookup,
      metadata: { osirus_plan: plan.plan },
    });
    report(`Price ${plan.label}: created (${plan.eur} EUR/month)`);
  } else {
    const ok =
      price.unit_amount === plan.eur * 100 &&
      price.currency === "eur" &&
      price.recurring?.interval === "month";
    report(
      `Price ${plan.label}: ${ok ? "ok" : "DIFFERS"} (${(price.unit_amount ?? 0) / 100} ${price.currency.toUpperCase()}/${price.recurring?.interval})`,
    );
    if (!ok)
      problems.push(`Price ${plan.label} differs from ${plan.eur} EUR/month.`);
  }
  prices[plan.plan] = price;
}

// 3. Webhook endpoint
const url = webhookUrl(publicUrl);
const endpoints = await stripe.webhookEndpoints.list({ limit: 100 });
let endpoint = pickEndpoint(endpoints.data, url);
let managedSecret = null;
if (endpoint) {
  const diff = endpointChanges(endpoint, url);
  if (diff) {
    endpoint = await stripe.webhookEndpoints.update(endpoint.id, diff.changes);
    report(
      `Webhook: updated (${Object.keys(diff.changes).join(", ")}${diff.missing.length ? `; added ${diff.missing.length} event(s)` : ""})`,
    );
  } else {
    report(
      `Webhook: ok at ${new URL(endpoint.url).pathname}, ${endpoint.enabled_events.length} event(s), ${endpoint.status}`,
    );
  }
} else if (createWebhook) {
  endpoint = await stripe.webhookEndpoints.create({
    url,
    enabled_events: REQUIRED_EVENTS,
    description: "Osirus billing (managed by scripts/stripe-setup.mjs)",
    metadata: { osirus_managed: "true" },
  });
  managedSecret = endpoint.secret ?? null;
  report("Webhook: created at /api/billing/webhook");
} else {
  problems.push("No webhook endpoint points at Osirus.");
  report("Webhook: MISSING (create_webhook=false)");
}

// The new endpoint's secret goes to Vercel only, never to the log.
if (managedSecret) {
  console.log(`::add-mask::${managedSecret}`);
  const token = process.env.VERCEL_TOKEN?.trim();
  const projectId = process.env.VERCEL_PROJECT_ID?.trim();
  const teamId = process.env.VERCEL_TEAM_ID?.trim();
  if (!token || !projectId) {
    problems.push(
      "Webhook created but VERCEL_TOKEN/VERCEL_PROJECT_ID are missing to store its secret.",
    );
  } else {
    const query = new URLSearchParams({
      upsert: "true",
      ...(teamId ? { teamId } : {}),
    });
    const response = await fetch(
      `https://api.vercel.com/v10/projects/${encodeURIComponent(projectId)}/env?${query}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify([
          {
            key: "STRIPE_WEBHOOK_SECRET_MANAGED",
            value: managedSecret,
            type: "sensitive",
            target: ["production", "preview"],
            comment:
              "Signing secret of the Osirus-managed Stripe webhook endpoint",
          },
        ]),
      },
    );
    if (!response.ok)
      problems.push(
        `Vercel refused the webhook secret (HTTP ${response.status}).`,
      );
    else
      report(
        "Webhook secret stored in Vercel (STRIPE_WEBHOOK_SECRET_MANAGED); redeploy to apply.",
      );
  }
}

// 4. Customer Portal
const configurations = await stripe.billingPortal.configurations.list({
  is_default: true,
  limit: 1,
});
if (configurations.data[0]) {
  report("Customer Portal: default configuration present");
} else {
  const products = {};
  for (const plan of PLANS) {
    const price = prices[plan.plan];
    const product =
      typeof price.product === "string" ? price.product : price.product.id;
    products[product] ??= [];
    products[product].push(price.id);
  }
  await stripe.billingPortal.configurations.create({
    business_profile: { headline: "Osirus: Abo verwalten" },
    default_return_url: new URL("/app", publicUrl).toString(),
    features: {
      customer_update: {
        enabled: true,
        allowed_updates: ["email", "address", "name"],
      },
      invoice_history: { enabled: true },
      payment_method_update: { enabled: true },
      subscription_cancel: { enabled: true, mode: "at_period_end" },
      subscription_update: {
        enabled: true,
        default_allowed_updates: ["price"],
        proration_behavior: "create_prorations",
        products: Object.entries(products).map(([product, list]) => ({
          product,
          prices: list,
        })),
      },
    },
  });
  report("Customer Portal: default configuration created");
}

// 5. End to end: the deployed webhook accepts a delivery signed with the
// secret GitHub holds (an event type Osirus ignores, so nothing changes).
const signingSecret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
if (signingSecret) {
  const payload = JSON.stringify({
    id: `evt_osirus_setup_${Date.now()}`,
    object: "event",
    type: "osirus.setup.ping",
    created: Math.floor(Date.now() / 1000),
    data: { object: {} },
  });
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Stripe-Signature": stripeSignature(
        payload,
        signingSecret,
        Math.floor(Date.now() / 1000),
      ),
    },
    body: payload,
  });
  if (response.ok)
    report(
      "Live webhook: signature accepted (Vercel has the same secret as GitHub).",
    );
  else {
    report(`Live webhook: HTTP ${response.status}`);
    problems.push(
      response.status === 400
        ? "The live webhook rejects STRIPE_WEBHOOK_SECRET: Vercel's value differs, or the deployment predates the sync (redeploy)."
        : `The live webhook answered HTTP ${response.status}.`,
    );
  }
}

if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    `### Stripe\n${summary.join("\n")}\n${problems.map((p) => `- **Problem:** ${p}`).join("\n")}\n`,
  );
}
if (problems.length) {
  for (const problem of problems) console.log(`::warning::${problem}`);
}
console.log(
  problems.length
    ? `${problems.length} problem(s) to fix.`
    : "Stripe is ready.",
);
