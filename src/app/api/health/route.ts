import { authConfigured } from "@/lib/auth/server";
import { db } from "@/lib/db/client";
import { env, serverKeys } from "@/lib/env";
import { logger } from "@/lib/telemetry/logger";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Anonymous and public: a flood of health probes must not turn into a flood
// of database queries. One check per instance every 15 seconds.
const DATABASE_CHECK_TTL_MS = 15_000;
let lastDatabaseCheck: { at: number; ok: Promise<boolean> } | null = null;

function databaseReachable(requestId: string) {
  const now = Date.now();
  if (lastDatabaseCheck && now - lastDatabaseCheck.at < DATABASE_CHECK_TTL_MS)
    return lastDatabaseCheck.ok;
  const ok = db()
    .query("select 1 as ok")
    .then(() => true)
    .catch(() => {
      logger.warn("health.database_unreachable", { requestId });
      return false;
    });
  lastDatabaseCheck = { at: now, ok };
  return ok;
}

export async function GET(request: Request) {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  const database = env.DATABASE_URL
    ? await databaseReachable(requestId)
    : false;

  // Configuration only (M49: free-model-first, so no model role is
  // required). Not a readiness probe: see /api/readiness for evidence.
  const provider = Boolean(env.UNOROUTER_BASE_URL && serverKeys().length > 0);
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
