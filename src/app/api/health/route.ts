import { authConfigured } from "@/lib/auth/server";
import { db } from "@/lib/db/client";
import { env, serverKeys } from "@/lib/env";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  let database = false;
  if (env.DATABASE_URL) {
    try {
      const sql = db();
      await sql.query("select 1 as ok");
      database = true;
    } catch {
      database = false;
    }
  }

  const provider = Boolean(
    env.UNOROUTER_BASE_URL &&
      serverKeys().length > 0 &&
      env.OSIRUS_MODEL_STRONG,
  );
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
    },
    {
      status: 200,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
