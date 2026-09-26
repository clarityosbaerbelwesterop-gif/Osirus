import { SOFTWARE_RSI_EXPECTATION } from "@/lib/security/github-oidc";
import { authorizeRsiCaller, boundedJson } from "@/lib/security/rsi-callers";

export const dynamic = "force-dynamic";

/** RSI is P4: it waits while chat needs the free models (M49). */
async function rsiAdmission() {
  const { UnoRouterProvider } = await import("@/lib/models/unorouter");
  const admission = await new UnoRouterProvider({ priority: "P4" }).admission();
  return admission.admitted;
}
export const runtime = "nodejs";

// Software RSI (M45). The software-rsi workflow takes one code hypothesis a
// day -- a deterministic Osirus mechanism that failed its oracle, outside
// the trust root and on the allowlist -- with its reserved model calls, and
// reports what it did: a draft pull request, or no verified improvement.
// Nothing here merges anything.

export async function GET(request: Request) {
  const refused = await authorizeRsiCaller(
    request,
    SOFTWARE_RSI_EXPECTATION,
    "rsi.software.take",
  );
  if (refused) return refused;
  const { PgIntelStore } = await import("@/lib/intelligence/store/pg-store");
  const { takeCodeHypothesis } =
    await import("@/lib/intelligence/rsi/exchange");
  const taken = await takeCodeHypothesis(
    new PgIntelStore(),
    new Date(),
    rsiAdmission,
  );
  if (!taken) return new Response(null, { status: 204 });
  return Response.json(taken, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const refused = await authorizeRsiCaller(
    request,
    SOFTWARE_RSI_EXPECTATION,
    "rsi.software.report",
  );
  if (refused) return refused;
  const { codeReportSchema, reportCodeAttempt } =
    await import("@/lib/intelligence/rsi/exchange");
  const parsed = codeReportSchema.safeParse(await boundedJson(request));
  if (!parsed.success)
    return Response.json({ error: "invalid_report" }, { status: 400 });
  const { PgIntelStore } = await import("@/lib/intelligence/store/pg-store");
  const result = await reportCodeAttempt(new PgIntelStore(), parsed.data);
  return Response.json(result, { status: result.accepted ? 200 : 409 });
}
