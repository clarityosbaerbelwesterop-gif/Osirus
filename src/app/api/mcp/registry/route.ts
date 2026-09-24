import { z } from "zod";
import { searchRegistry } from "@/lib/connectors/mcp-registry";
import { apiIdentity, json } from "@/lib/product/api";
import { enforceRateLimit, RateLimitError } from "@/lib/security/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const identity = await apiIdentity();
  if (!identity) return json({ error: "unauthorized" }, 401);
  const query = z
    .string()
    .trim()
    .min(2)
    .max(80)
    .safeParse(new URL(request.url).searchParams.get("q")).data;
  if (!query) return json({ error: "invalid_request" }, 400);
  try {
    await enforceRateLimit({
      subject: `user:${identity.userId}`,
      route: "mcp.registry",
      limit: 30,
    });
  } catch (error) {
    return json(
      {
        error:
          error instanceof RateLimitError
            ? "rate_limited"
            : "service_unavailable",
      },
      error instanceof RateLimitError ? 429 : 503,
    );
  }
  try {
    return json({ servers: await searchRegistry(query) });
  } catch {
    return json({ error: "registry_unavailable" }, 502);
  }
}
