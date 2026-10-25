import { NextResponse, type NextRequest } from "next/server";
import { auth, authConfigured } from "@/lib/auth/server";

/**
 * Completes Neon Auth's OAuth handshake and protects the product surface.
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
 */
const protectedRoutes = auth.middleware({ loginUrl: "/auth/sign-in" });

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

  // Fail closed: without the Neon Auth env vars there is no real provider to
  // verify sessions against, so running the middleware could only error or,
  // worse, wave unauthenticated traffic onto the product surface.
  if (!authConfigured) {
    return new Response("Authentication is not configured", { status: 500 });
  }
  const response = await protectedRoutes(request);
  // Propagate the caller's correlation id, or mint one, so request logs can
  // be tied together across the boundary.
  response.headers.set("X-Request-Id", requestId);
  return response;
}

export const config = {
  matcher: ["/app", "/app/:path*"],
};
