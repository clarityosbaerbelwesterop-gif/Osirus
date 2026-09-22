import { authConfigured } from "@/lib/auth/server";
import { db } from "@/lib/db/client";
import { env, serverKeys } from "@/lib/env";
import { logger } from "@/lib/telemetry/logger";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  let database = false;
  if (env.DATABASE_URL) {
    try {
      const sql = db();
      await sql.query("select 1 as ok");
      database = true;
    } catch {
      database = false;
      logger.warn("health.database_unreachable", { requestId });
    }
  }

  const provider = Boolean(
    env.UNOROUTER_BASE_URL &&
    serverKeys().length > 0 &&
    env.OSIRUS_MODEL_STRONG,
  );
  // Reported, not gated. Hosted execution being unconfigured is a capability
  // the deployment lacks, not a fault: runs still work, and anything needing
  // execution comes back unverified rather than claiming it ran. Folding it
  // into `status` would make a healthy deployment look broken.
  const { sandboxAvailability } = await import("@/lib/sandbox");
  const sandbox = await sandboxAvailability();

  const status = authConfigured && database && provider ? "ok" : "degraded";

  return Response.json(
    {
      status,
      service: "osirus",
      checks: {
        auth: authConfigured,
        database,
        provider,
      },
      capabilities: {
        sandbox: sandbox.configured ? sandbox.driver : "NOT_CONFIGURED",
        sandboxReason: sandbox.reason,
      },
      version: env.VERCEL_GIT_COMMIT_SHA ?? "local",
      runtime: "nodejs",
      timestamp: new Date().toISOString(),
    },
    {
      status: 200,
      headers: { "Cache-Control": "no-store", "X-Request-Id": requestId },
    },
  );
}
