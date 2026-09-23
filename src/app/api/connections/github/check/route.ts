import { checkGithubHealth } from "@/lib/connectors/health";
import { guardAction, json } from "@/lib/product/api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Run a live GitHub check now and record it. */
export async function POST(request: Request) {
  const guard = await guardAction(request, {
    route: "connections.check",
    limit: 12,
  });
  if (!guard.ok) return guard.response;
  const result = await checkGithubHealth(guard.identity);
  if (!result) return json({ error: "not_connected" }, 409);
  return json({
    ok: result.ok,
    latencyMs: result.latencyMs,
    error: result.error,
  });
}
