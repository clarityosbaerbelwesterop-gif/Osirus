import { NextRequest, NextResponse } from "next/server";
import { describe, expect, it, vi } from "vitest";

const seen = vi.hoisted(() => ({ requests: [] as Request[] }));

vi.mock("@/lib/auth/server", () => ({
  authConfigured: true,
  auth: {
    middleware: vi.fn(() => async (request: NextRequest) => {
      seen.requests.push(request);
      // Like Neon's "allow" branch: forward every request header.
      return NextResponse.next({
        request: { headers: new Headers(request.headers) },
      });
    }),
  },
}));

const proxyModule = await import("@/proxy");
const proxy = proxyModule.default;
const { config } = proxyModule;

const page = (path: string) =>
  new NextRequest(new URL(path, "https://osirus-ai.com"));

function nonceOf(policy: string | null) {
  return policy?.match(/'nonce-([A-Za-z0-9+/=]+)'/)?.[1] ?? null;
}

describe("auth proxy", () => {
  it("runs the Neon Auth middleware so the OAuth verifier is exchanged", async () => {
    const { auth } = await import("@/lib/auth/server");
    expect(auth.middleware).toHaveBeenCalledWith({ loginUrl: "/auth/sign-in" });
    seen.requests.length = 0;
    await proxy(page("/app/settings"));
    expect(seen.requests).toHaveLength(1);
    // Public pages never go through the auth middleware.
    await proxy(page("/legal/privacy"));
    expect(seen.requests).toHaveLength(1);
  });
});

describe("content security policy per page (audit 2026-11-17)", () => {
  it("gives each page a fresh nonce and no inline script without it", async () => {
    const first = await proxy(page("/"));
    const second = await proxy(page("/"));
    const policy = first.headers.get("content-security-policy");
    const nonce = nonceOf(policy);
    expect(nonce).toBeTruthy();
    expect(nonceOf(second.headers.get("content-security-policy"))).not.toBe(
      nonce,
    );
    expect(policy).toContain("'strict-dynamic'");
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).toContain("object-src 'none'");
    // The nonce reaches the render (Next reads the request header).
    expect(first.headers.get("x-middleware-request-x-nonce")).toBe(nonce);
    expect(
      first.headers.get("x-middleware-request-content-security-policy"),
    ).toBe(policy);
  });

  it("hands the nonce to Neon's middleware on protected pages", async () => {
    seen.requests.length = 0;
    const response = await proxy(page("/app"));
    const nonce = nonceOf(response.headers.get("content-security-policy"));
    expect(seen.requests[0]!.headers.get("x-nonce")).toBe(nonce);
    expect(response.headers.get("x-middleware-request-x-nonce")).toBe(nonce);
  });

  it("covers pages, not API routes, build assets or public files", () => {
    const [entry] = config.matcher;
    const pattern = new RegExp(`^${entry!.source}$`);
    for (const path of [
      "/",
      "/app",
      "/app/settings",
      "/legal/privacy",
      "/s/abc",
    ])
      expect(pattern.test(path), path).toBe(true);
    for (const path of [
      "/api/chat/stream",
      "/_next/static/chunks/x.js",
      "/robots.txt",
      "/sitemap.xml",
      "/.well-known/security.txt",
    ])
      expect(pattern.test(path), path).toBe(false);
  });

  it("still rewrites a Stripe webhook sent to /app", async () => {
    const request = new NextRequest("https://osirus-ai.com/app", {
      method: "POST",
      headers: { "stripe-signature": "t=1,v1=abc" },
    });
    const response = await proxy(request);
    expect(response.headers.get("x-middleware-rewrite")).toBe(
      "https://osirus-ai.com/api/billing/webhook",
    );
  });
});

describe("style policy in production", () => {
  it("needs the nonce for <style> elements and allows only style attributes inline", async () => {
    const { pageContentSecurityPolicy } = await import("@/lib/security/csp");
    const policy = pageContentSecurityPolicy("abc123", false);
    expect(policy).toContain("style-src-elem 'self' 'nonce-abc123'");
    expect(policy).toContain("style-src-attr 'unsafe-inline'");
    expect(policy).toContain("script-src 'nonce-abc123' 'strict-dynamic'");
    expect(policy).toContain("upgrade-insecure-requests");
  });
});

describe("scanner probes and duplicate hosts (hardening 2026-11-17)", () => {
  it("answers vulnerability-scanner paths with a cacheable empty 404", async () => {
    seen.requests.length = 0;
    for (const path of [
      "/wp-login.php",
      "/wp-admin/install.php",
      "/.env",
      "/.git/config",
      "/phpmyadmin/",
      "/xmlrpc.php",
      "/vendor/phpunit/phpunit/src/Util/PHP/eval-stdin.php",
      "/cgi-bin/luci",
    ]) {
      const response = await proxy(page(path));
      expect(response.status, path).toBe(404);
      expect(response.headers.get("cache-control")).toContain("max-age");
      expect(await response.text()).toBe("");
    }
    // Never reached the auth middleware or a page render.
    expect(seen.requests).toHaveLength(0);
  });

  it("leaves real pages alone", async () => {
    for (const path of ["/", "/legal/privacy", "/sicherheit", "/s/abc"]) {
      const response = await proxy(page(path));
      expect(response.status, path).not.toBe(404);
    }
  });

  it("marks pages on any host but the public one as noindex", async () => {
    const onVercel = await proxy(
      new NextRequest("https://osirus-ai.vercel.app/", {
        headers: { host: "osirus-ai.vercel.app" },
      }),
    );
    expect(onVercel.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    const onDomain = await proxy(
      new NextRequest("https://osirus-ai.com/", {
        headers: { host: "osirus-ai.com" },
      }),
    );
    expect(onDomain.headers.get("x-robots-tag")).toBeNull();
  });
});
