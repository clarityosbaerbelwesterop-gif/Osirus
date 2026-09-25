import { auth } from "@/lib/auth/server";

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
 * The matcher is deliberately narrow: public pages, legal pages, the auth API
 * and health/readiness probes never pass through here.
 */
export default auth.middleware({ loginUrl: "/auth/sign-in" });

export const config = {
  matcher: ["/app", "/app/:path*"],
};
