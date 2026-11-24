import { authAttemptAllowed } from "@/app/auth/rate";
import { auth, requireAuthConfiguration } from "@/lib/auth/server";

const handlers = auth.handler();
type AuthRouteContext = { params: Promise<{ path: string[] }> };

// The sign-in, sign-up and reset forms are rate-limited in their server
// actions; the same endpoints are also reachable here directly, so the same
// limits apply here (per address and per network).
const LIMITED: Record<
  string,
  { route: string; perAddress: number; perNetwork: number }
> = {
  "sign-in/email": { route: "auth.signin", perAddress: 10, perNetwork: 30 },
  "sign-up/email": { route: "auth.signup", perAddress: 6, perNetwork: 12 },
  "request-password-reset": {
    route: "auth.reset",
    perAddress: 3,
    perNetwork: 10,
  },
  "forget-password": { route: "auth.reset", perAddress: 3, perNetwork: 10 },
  // Every endpoint that sends an e-mail: without a limit, anyone could send
  // our verification mails to any address in a loop (spam in our name, a
  // damaged sender reputation). Reset links are long random tokens; the
  // network limit still stops a scripted run against them.
  "send-verification-email": {
    route: "auth.verify-mail",
    perAddress: 3,
    perNetwork: 10,
  },
  "change-email": { route: "auth.change-email", perAddress: 3, perNetwork: 10 },
  "sign-in/magic-link": {
    route: "auth.magic-link",
    perAddress: 3,
    perNetwork: 10,
  },
  "email-otp/send-verification-otp": {
    route: "auth.otp",
    perAddress: 3,
    perNetwork: 10,
  },
  "reset-password": {
    route: "auth.reset-token",
    perAddress: 10,
    perNetwork: 20,
  },
  "change-password": {
    route: "auth.change-password",
    perAddress: 10,
    perNetwork: 20,
  },
};

export async function GET(request: Request, context: AuthRouteContext) {
  requireAuthConfiguration();
  return handlers.GET(request, context);
}

export async function POST(request: Request, context: AuthRouteContext) {
  requireAuthConfiguration();
  const { path } = await context.params;
  const limit = LIMITED[path.join("/")];
  if (limit) {
    const body = (await request
      .clone()
      .json()
      .catch(() => null)) as { email?: unknown } | null;
    // Requests without an address (a reset token, a signed-in change) are
    // counted under their path, so the network limit carries them.
    const email =
      typeof body?.email === "string"
        ? body.email
        : typeof (body as { newEmail?: unknown } | null)?.newEmail === "string"
          ? String((body as { newEmail: string }).newEmail)
          : "";
    if (!(await authAttemptAllowed({ ...limit, email })))
      return Response.json(
        {
          code: "TOO_MANY_REQUESTS",
          message: "Zu viele Versuche. Bitte warte kurz.",
        },
        { status: 429 },
      );
  }
  return handlers.POST(request, context);
}
