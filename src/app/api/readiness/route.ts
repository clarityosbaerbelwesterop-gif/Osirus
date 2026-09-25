import { after } from "next/server";
import { assessReadiness } from "@/lib/readiness/assess";
import { readinessEvidence } from "@/lib/readiness/collect";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Readiness from cached, background-collected evidence (M49 section 8).
// Cheap on every request: a fresh cache is returned as is, a stale one is
// returned while a refresh runs after the response. No model inference is
// ever run here; model readiness is the last *successful* free-model
// inference that real traffic produced, with its timestamp.
export async function GET(request: Request) {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  const evidence = await readinessEvidence((task) => after(() => task));
  const body = assessReadiness(evidence, Date.now());
  return Response.json(body, {
    status: body.ready ? 200 : 503,
    headers: { "Cache-Control": "no-store", "X-Request-Id": requestId },
  });
}
