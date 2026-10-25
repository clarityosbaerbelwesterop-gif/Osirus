import { after } from "next/server";
import { auth, authConfigured } from "@/lib/auth/server";
import { isOperator } from "@/lib/intelligence/production/operator";
import { assessReadiness } from "@/lib/readiness/assess";
import { readinessEvidence } from "@/lib/readiness/collect";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Readiness from cached, background-collected evidence (M49 section 8).
// Cheap on every request: a fresh cache is returned as is, a stale one is
// returned while a refresh runs after the response. No model inference is
// ever run here; model readiness is the last *successful* free-model
// inference that real traffic produced, with its timestamp.
// Detailed operational diagnostics are returned only to authenticated
// operators (RT2-06); anonymous probes receive { status, ready } only.
export async function GET(request: Request) {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  const evidence = await readinessEvidence((task) => after(() => task));
  const body = assessReadiness(evidence, Date.now());
  let operator = false;
  if (authConfigured) {
    const session = await auth.getSession().catch(() => ({ data: null }));
    if (session?.data?.user?.id) {
      operator = await isOperator(session.data.user.id).catch(() => false);
    }
  }
  const payload = operator ? body : { status: body.status, ready: body.ready };
  return Response.json(payload, {
    status: body.ready ? 200 : 503,
    headers: { "Cache-Control": "no-store", "X-Request-Id": requestId },
  });
}
