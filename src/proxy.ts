import { NextRequest, NextResponse } from "next/server";
import { auth, authConfigured } from "@/lib/auth/server";
import { pageContentSecurityPolicy } from "@/lib/security/csp";

/**
 * Completes Neon Auth's OAuth handshake, protects the product surface and
 * gives every page a per-request script nonce.
 *
 * After GitHub authorises, Neon Auth sends the browser back to `/app` with a
 * one-time `neon_auth_session_verifier` query parameter. Only the Neon Auth
 * middleware exchanges that verifier (plus the session-challenge cookie set
 * when sign-in started) for the real session cookie. Without this proxy the
 * exchange never happens, `/app` finds no session and redirects to
 * `/auth/sign-in`, which is exactly the production failure in issue #26.
 *
 * Also transparently rewrites Stripe webhook POST deliveries sent to `/app`
 * (when the operator configured `https://osirus-ai.vercel.app/app` as the
 * Stripe webhook endpoint) directly to `/api/billing/webhook`.
 *
 * Content Security Policy (audit 2026-11-17): pages allowed every inline
 * script ('unsafe-inline'), so an injected <script> would have run. Each
 * page request now gets a fresh nonce; only scripts carrying it, and what
 * they load ('strict-dynamic'), run. Next.js reads the nonce from the
 * request's CSP header and puts it on its own scripts. The Neon middleware
 * forwards all request headers, so protected pages get it too.
 */
const protectedRoutes = auth.middleware({ loginUrl: "/auth/sign-in" });

function isProtected(pathname: string) {
  return pathname === "/app" || pathname.startsWith("/app/");
}

export default async function proxy(request: NextRequest) {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();

  if (
    request.method === "POST" &&
    request.headers.get("stripe-signature")?.trim()
  ) {
    const base =
      typeof request.url === "string" && request.url.startsWith("http")
        ? request.url
        : "https://osirus-ai.vercel.app";
    const target = new URL("/api/billing/webhook", base);
    const rewritten = NextResponse.rewrite(target);
    rewritten.headers.set("X-Request-Id", requestId);
    return rewritten;
  }

  const nonce = btoa(crypto.randomUUID());
  const policy = pageContentSecurityPolicy(
    nonce,
    process.env.NODE_ENV !== "production",
  );
  const headers = new Headers(request.headers);
  headers.set("x-nonce", nonce);
  headers.set("content-security-policy", policy);

  let response: NextResponse | Response;
  if (isProtected(request.nextUrl.pathname)) {
    // Fail closed: without the Neon Auth env vars there is no real provider
    // to verify sessions against, so running the middleware could only
    // error or, worse, wave unauthenticated traffic onto the product surface.
    if (!authConfigured) {
      return new Response("Authentication is not configured", {
        status: 500,
        headers: { "Content-Security-Policy": policy },
      });
    }
    response = await protectedRoutes(new NextRequest(request, { headers }));
  } else {
    response = NextResponse.next({ request: { headers } });
  }
  response.headers.set("Content-Security-Policy", policy);
  // Propagate the caller's correlation id, or mint one, so request logs can
  // be tied together across the boundary.
  response.headers.set("X-Request-Id", requestId);
  return response;
}

export const config = {
  matcher: [
    {
      // Pages only: API routes, build assets and public files keep the
      // static policy from next.config.ts. Prefetches skip the proxy.
      source:
        "/((?!api/|_next/static|_next/image|favicon.ico|icon.svg|robots.txt|sitemap.xml|\\.well-known/).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
