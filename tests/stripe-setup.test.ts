import Stripe from "stripe";
import { describe, expect, it } from "vitest";
import { HANDLED_EVENT_TYPES } from "@/lib/billing/webhook";
import {
  endpointChanges,
  keyMode,
  lookupKeyFor,
  pickEndpoint,
  REQUIRED_EVENTS,
  stripeSignature,
  webhookUrl,
} from "../scripts/lib/stripe-setup.mjs";

const URL_ = "https://osirus-ai.vercel.app/api/billing/webhook";

describe("stripe setup", () => {
  it("listens to exactly the events the webhook handles", () => {
    expect([...REQUIRED_EVENTS].sort()).toEqual(
      [...HANDLED_EVENT_TYPES].sort(),
    );
  });

  it("uses the lookup keys the app resolves prices by", () => {
    expect(lookupKeyFor("pro")).toBe("osirus_pro_monthly_eur");
    expect(webhookUrl("https://osirus-ai.vercel.app")).toBe(URL_);
  });

  it("finds Osirus's endpoint by URL, else by host", () => {
    const exact = { id: "a", url: URL_ };
    const app = { id: "b", url: "https://osirus-ai.vercel.app/app" };
    const other = { id: "c", url: "https://example.com/hook" };
    expect(pickEndpoint([other, app, exact], URL_)?.id).toBe("a");
    expect(pickEndpoint([other, app], URL_)?.id).toBe("b");
    expect(pickEndpoint([other], URL_)).toBeNull();
  });

  it("moves an /app endpoint, adds missing events and re-enables", () => {
    const diff = endpointChanges(
      {
        url: "https://osirus-ai.vercel.app/app",
        enabled_events: ["checkout.session.completed"],
        status: "disabled",
      },
      URL_,
    );
    expect(diff?.changes.url).toBe(URL_);
    expect(diff?.changes.disabled).toBe(false);
    expect(diff?.changes.enabled_events).toEqual(
      expect.arrayContaining(REQUIRED_EVENTS),
    );
    expect(
      endpointChanges(
        { url: URL_, enabled_events: ["*"], status: "enabled" },
        URL_,
      ),
    ).toBeNull();
  });

  it("signs like Stripe, so the live webhook can be checked end to end", () => {
    const payload = JSON.stringify({
      id: "evt_1",
      type: "x",
      data: { object: {} },
    });
    const secret = "whsec_test";
    const header = stripeSignature(
      payload,
      secret,
      Math.floor(Date.now() / 1000),
    );
    const event = new Stripe("sk_test_x").webhooks.constructEvent(
      payload,
      header,
      secret,
    );
    expect(event.id).toBe("evt_1");
  });

  it("tells live from test keys without printing them", () => {
    expect(keyMode("sk_live_abc")).toBe("live");
    expect(keyMode("rk_test_abc")).toBe("test");
    expect(keyMode(undefined)).toBe("unknown");
  });
});
