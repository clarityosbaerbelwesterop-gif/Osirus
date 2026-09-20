import { auth, requireAuthConfiguration } from "@/lib/auth/server";

const handlers = auth.handler();

export async function GET(request: Request) {
  requireAuthConfiguration();
  return handlers.GET(request);
}

export async function POST(request: Request) {
  requireAuthConfiguration();
  return handlers.POST(request);
}
