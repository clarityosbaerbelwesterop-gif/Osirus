import { existsSync } from "node:fs";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

// Regression coverage for AUTH-1 (proxy fails closed) and AUTH-2 (the
// X-Request-Id behaviour of the dead root proxy.ts moved into src/proxy.ts).

const state = vi.hoisted(() => ({
  configured: true,
  handler: vi.fn(async () => new Response("ok")),
  middleware: vi.fn(),
}));

vi.mock("@/lib/auth/server", () => ({
  get authConfigured() {
    return state.configured;
  },
  auth: {
    middleware: (options: unknown) => {
      state.middleware(options);
      return state.handler;
    },
  },
}));

const requestTo = (path: string, headers: Record<string, string> = {}) =>
  new NextRequest(new URL(path, "https://osirus-ai.com"), { headers });

describe("proxy request boundary", () => {
  afterEach(() => {
    state.configured = true;
    state.handler.mockClear();
  });

  it("fails closed with 500 when authentication is not configured", async () => {
    state.configured = false;
    const { default: proxy } = await import("@/proxy");
    const response = await proxy(requestTo("/app"));
    expect(response.status).toBe(500);
    expect(await response.text()).toBe("Authentication is not configured");
    // The auth middleware must not run when there is no real provider.
    expect(state.handler).not.toHaveBeenCalled();
  });

  it("delegates to the Neon Auth middleware when configured", async () => {
    const { default: proxy } = await import("@/proxy");
    const request = requestTo("/app");
    const response = await proxy(request);
    expect(response.status).not.toBe(500);
    expect(state.middleware).toHaveBeenCalledWith({
      loginUrl: "/auth/sign-in",
    });
    // The middleware gets the request with this page's script nonce added.
    expect(state.handler).toHaveBeenCalledTimes(1);
    const handed = (state.handler.mock.calls[0] as unknown[])[0] as NextRequest;
    expect(handed.nextUrl.pathname).toBe(request.nextUrl.pathname);
    expect(handed.headers.get("x-nonce")).toBeTruthy();
  });

  it("echoes an incoming X-Request-Id header", async () => {
    const { default: proxy } = await import("@/proxy");
    const response = await proxy(
      requestTo("/app", { "x-request-id": "req-123" }),
    );
    expect(response.headers.get("x-request-id")).toBe("req-123");
  });

  it("mints a UUID X-Request-Id when the request has none", async () => {
    const { default: proxy } = await import("@/proxy");
    const response = await proxy(requestTo("/app"));
    expect(response.headers.get("x-request-id")).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it("has no dead duplicate proxy at the repository root", () => {
    expect(existsSync(join(__dirname, "..", "proxy.ts"))).toBe(false);
  });

  it("rewrites Stripe webhook POSTs on /app to /api/billing/webhook without invoking auth", async () => {
    state.configured = false;
    const { default: proxy } = await import("@/proxy");
    const req = new NextRequest("https://osirus-ai.vercel.app/app", {
      method: "POST",
      headers: {
        "stripe-signature": "t=1700000000,v1=deadbeef",
        "x-request-id": "stripe-req-1",
      },
    });
    const response = await proxy(req);
    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-rewrite")).toBe(
      "https://osirus-ai.vercel.app/api/billing/webhook",
    );
    expect(response.headers.get("x-request-id")).toBe("stripe-req-1");
    expect(state.handler).not.toHaveBeenCalled();
  });
});
