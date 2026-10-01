import { existsSync } from "node:fs";
import { join } from "node:path";
import type { NextRequest } from "next/server";
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
  ({ headers: new Headers(headers), url: path }) as unknown as NextRequest;

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
    expect(state.handler).toHaveBeenCalledWith(request);
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
});
