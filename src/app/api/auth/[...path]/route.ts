import { auth, requireAuthConfiguration } from "@/lib/auth/server";

const handlers = auth.handler();
type AuthRouteContext = { params: Promise<{ path: string[] }> };

export async function GET(request: Request, context: AuthRouteContext) {
  requireAuthConfiguration();
  return handlers.GET(request, context);
}

export async function POST(request: Request, context: AuthRouteContext) {
  requireAuthConfiguration();
  return handlers.POST(request, context);
}
