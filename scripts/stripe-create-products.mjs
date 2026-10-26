// Create the four Osirus plans (product + monthly EUR price) in Stripe TEST
// mode and print the env lines to set. Not run automatically.
//
//   STRIPE_SECRET_KEY=sk_test_... node scripts/stripe-create-products.mjs
//   (add --dry-run to only print what would be created)
//
// Refuses live keys. Idempotent: a product is found by its lookup metadata
// and a price by its lookup_key, so rerunning creates nothing twice. No VAT
// is charged (Kleinunternehmer, § 19 UStG) and Stripe Tax is off, so the
// list price is exactly what the customer pays. tax_behavior "inclusive"
// only matters if Stripe Tax is ever switched on: the price would then stay
// the same. Nothing secret is printed.

import Stripe from "stripe";

const PLANS = [
  { plan: "pro", name: "Osirus Pro", eur: 20, env: "STRIPE_PRICE_PRO" },
  {
    plan: "developer",
    name: "Osirus Developer",
    eur: 50,
    env: "STRIPE_PRICE_DEVELOPER",
  },
  {
    plan: "ultra_100",
    name: "Osirus Ultra 100",
    eur: 100,
    env: "STRIPE_PRICE_ULTRA_100",
  },
  {
    plan: "ultra_200",
    name: "Osirus Ultra 200",
    eur: 200,
    env: "STRIPE_PRICE_ULTRA_200",
  },
];

const dryRun = process.argv.includes("--dry-run");
const key = process.env.STRIPE_SECRET_KEY?.trim();

if (!key) {
  console.error("STRIPE_SECRET_KEY is not set.");
  process.exit(1);
}
if (
  !key.startsWith("sk_test_") &&
  !key.startsWith("rk_test_") &&
  !key.startsWith("sk_live_") &&
  !key.startsWith("rk_live_")
) {
  console.error(
    "Refusing to run: STRIPE_SECRET_KEY must start with sk_test_, rk_test_, sk_live_, or rk_live_.",
  );
  process.exit(1);
}

const stripe = new Stripe(key, { apiVersion: "2026-09-30.endive" });

async function findProduct(plan) {
  const result = await stripe.products.search({
    query: `metadata['osirus_plan']:'${plan}'`,
  });
  return result.data[0] ?? null;
}

const lines = [];
for (const entry of PLANS) {
  const lookupKey = `osirus_${entry.plan}_monthly_eur`;
  const existing = await stripe.prices.list({
    lookup_keys: [lookupKey],
    limit: 1,
  });
  if (existing.data[0]) {
    lines.push(`${entry.env}=${existing.data[0].id}`);
    console.log(`${entry.name}: price exists (${lookupKey})`);
    continue;
  }
  if (dryRun) {
    console.log(
      `${entry.name}: would create ${entry.eur} EUR/month (${lookupKey})`,
    );
    continue;
  }
  const product =
    (await findProduct(entry.plan)) ??
    (await stripe.products.create({
      name: entry.name,
      metadata: { osirus_plan: entry.plan },
    }));
  const price = await stripe.prices.create({
    product: product.id,
    currency: "eur",
    unit_amount: entry.eur * 100,
    recurring: { interval: "month" },
    tax_behavior: "inclusive",
    lookup_key: lookupKey,
    metadata: { osirus_plan: entry.plan },
  });
  lines.push(`${entry.env}=${price.id}`);
  console.log(`${entry.name}: created ${entry.eur} EUR/month (${lookupKey})`);
}

if (lines.length) {
  console.log("\nSet these environment variables:");
  for (const line of lines) console.log(line);
}
