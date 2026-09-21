import { auth } from "@/lib/auth/server";
import type { NextRequest } from "next/server";

const protectedRoutes = auth.middleware({
  loginUrl: "/auth/sign-in",
});

/** Next.js 16 request boundary for protected routes and response correlation. */
export async function proxy(request: NextRequest) {
  const response = await protectedRoutes(request);
  response.headers.set(
    "X-Request-Id",
    request.headers.get("x-request-id") ?? crypto.randomUUID(),
  );
  return response;
}

export const config = {
  matcher: ["/app/:path*"],
};
