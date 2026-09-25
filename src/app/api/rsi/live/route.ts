import { RSI_LIVE_EXPECTATION } from "@/lib/security/github-oidc";
import { authorizeRsiCaller, boundedJson } from "@/lib/security/rsi-callers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// The live lane of the Recursive Intelligence Cycle. The rsi-live workflow
// takes the open live order (champion vs challenger on the same tasks, plus
// raw-model-vs-Osirus pairs) with its reserved model calls, runs it on the
// free model, and posts the rows back. The cycle decides from the rows.

export async function GET(request: Request) {
  const refused = await authorizeRsiCaller(
    request,
    RSI_LIVE_EXPECTATION,
    "rsi.live.take",
  );
  if (refused) return refused;
  const { PgIntelStore } = await import("@/lib/intelligence/store/pg-store");
  const { takeLiveOrder } = await import("@/lib/intelligence/rsi/exchange");
  const order = await takeLiveOrder(new PgIntelStore());
  if (!order) return new Response(null, { status: 204 });
  return Response.json({ order }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const refused = await authorizeRsiCaller(
    request,
    RSI_LIVE_EXPECTATION,
    "rsi.live.report",
  );
  if (refused) return refused;
  const { liveEvidenceSchema, reportLiveEvidence } =
    await import("@/lib/intelligence/rsi/exchange");
  const parsed = liveEvidenceSchema.safeParse(await boundedJson(request));
  if (!parsed.success)
    return Response.json({ error: "invalid_evidence" }, { status: 400 });
  const { PgIntelStore } = await import("@/lib/intelligence/store/pg-store");
  const result = await reportLiveEvidence(new PgIntelStore(), parsed.data);
  return Response.json(result, { status: result.accepted ? 200 : 409 });
}
