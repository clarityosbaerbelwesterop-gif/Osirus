// Pure helpers for scripts/stripe-setup.mjs: which webhook endpoint is
// Osirus's, what it must listen to, and a Stripe-style signature for the
// end-to-end check. No I/O here; tested in tests/stripe-setup.test.ts.

import { createHmac } from "node:crypto";

export const PLANS = [
  { plan: "pro", label: "Pro", eur: 20 },
  { plan: "developer", label: "Developer", eur: 50 },
  { plan: "ultra_100", label: "Ultra 100", eur: 100 },
  { plan: "ultra_200", label: "Ultra 200", eur: 200 },
];

export const lookupKeyFor = (plan) => `osirus_${plan}_monthly_eur`;

/** The events src/lib/billing/webhook.ts handles (HANDLED_EVENT_TYPES). */
export const REQUIRED_EVENTS = [
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "customer.subscription.paused",
  "customer.subscription.resumed",
];

export function webhookUrl(publicUrl) {
  return new URL("/api/billing/webhook", publicUrl).toString();
}

/**
 * Osirus's endpoint among the account's: the one at the exact URL, else one
 * on the same host (e.g. ".../app", which the proxy forwards), else none.
 */
export function pickEndpoint(endpoints, url) {
  const target = new URL(url);
  const list = Array.isArray(endpoints) ? endpoints : [];
  return (
    list.find((endpoint) => endpoint?.url === url) ??
    list.find((endpoint) => {
      try {
        return new URL(endpoint.url).host === target.host;
      } catch {
        return false;
      }
    }) ??
    null
  );
}

/** What has to change on an endpoint; null when it is already right. */
export function endpointChanges(endpoint, url) {
  const events = Array.isArray(endpoint?.enabled_events)
    ? endpoint.enabled_events
    : [];
  const listensToAll = events.includes("*");
  const missing = listensToAll
    ? []
    : REQUIRED_EVENTS.filter((event) => !events.includes(event));
  const changes = {};
  if (endpoint.url !== url) changes.url = url;
  if (missing.length)
    changes.enabled_events = [...new Set([...events, ...REQUIRED_EVENTS])];
  if (endpoint.status === "disabled") changes.disabled = false;
  return Object.keys(changes).length ? { changes, missing } : null;
}

/** A Stripe-Signature header for a payload, as Stripe computes it. */
export function stripeSignature(payload, secret, timestamp) {
  const signed = createHmac("sha256", secret)
    .update(`${timestamp}.${payload}`)
    .digest("hex");
  return `t=${timestamp},v1=${signed}`;
}

/** live / test from the key prefix; never prints the key. */
export function keyMode(key) {
  if (/^(sk|rk)_live_/.test(key ?? "")) return "live";
  if (/^(sk|rk)_test_/.test(key ?? "")) return "test";
  return "unknown";
}
