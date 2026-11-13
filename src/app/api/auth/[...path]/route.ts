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
    const email = typeof body?.email === "string" ? body.email : "";
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
