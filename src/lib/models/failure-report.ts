// M49 section 9: honest fallback error reporting.
//
// When a request tries more than one model, each failure is kept separately.
// The failure that actually stopped completion is the one the caller sees
// (the thrown error's code is `finalFailure`), so "primary had no credit,
// then the free fallback was rate limited" surfaces as a rate limit -- not as
// the primary's credit refusal. Operators may see both. A report holds model
// IDs, failure categories, HTTP statuses and retry hints only: never keys,
// headers, hosts or request bodies.

export type AttemptFailure = {
  model: string;
  /** "primary" is the first model attempted; later models are fallbacks. */
  kind: "primary" | "fallback";
  code: string;
  status?: number;
  retryAfterMs?: number;
};

export type FailureReport = {
  primaryModel: string | null;
  primaryFailure: string | null;
  fallbackModel: string | null;
  fallbackFailure: string | null;
  /** The failure that prevented completion; equals the thrown error's code. */
  finalFailure: string | null;
  attempts: AttemptFailure[];
};

export class FailureReportBuilder {
  private readonly attempts: AttemptFailure[] = [];
  private primary: string | null = null;

  /** Note a model being attempted; the first one becomes the primary. */
  attempting(model: string) {
    if (this.primary === null) this.primary = model;
  }

  record(
    model: string,
    failure: { code: string; status?: number; retryAfterMs?: number },
  ) {
    this.attempting(model);
    this.attempts.push({
      model,
      kind: model === this.primary ? "primary" : "fallback",
      code: failure.code,
      ...(failure.status !== undefined ? { status: failure.status } : {}),
      ...(failure.retryAfterMs !== undefined
        ? { retryAfterMs: failure.retryAfterMs }
        : {}),
    });
  }

  get size() {
    return this.attempts.length;
  }

  build(finalFailure: string | null): FailureReport {
    const primaryAttempts = this.attempts.filter((a) => a.kind === "primary");
    const fallbackAttempts = this.attempts.filter((a) => a.kind === "fallback");
    const lastPrimary = primaryAttempts.at(-1) ?? null;
    const lastFallback = fallbackAttempts.at(-1) ?? null;
    return {
      primaryModel: this.primary,
      primaryFailure: lastPrimary?.code ?? null,
      fallbackModel: lastFallback?.model ?? null,
      fallbackFailure: lastFallback?.code ?? null,
      finalFailure,
      attempts: this.attempts.map((a) => ({ ...a })),
    };
  }
}

/** Read a report off an error, if one is attached (by shape). */
export function failureReportOf(error: unknown): FailureReport | null {
  if (!error || typeof error !== "object") return null;
  const report = (error as { report?: unknown }).report;
  if (!report || typeof report !== "object") return null;
  const r = report as FailureReport;
  return Array.isArray(r.attempts) ? r : null;
}

const SAFE_TOKEN = /^[A-Za-z0-9._:/@+-]{1,120}$/;
const safe = (value: string | null) =>
  value && SAFE_TOKEN.test(value) ? value : value ? "unknown" : null;

/**
 * Operator line, e.g.
 * "Primary grok-4.6: insufficient_credit / Fallback x:free: rate_limited".
 */
export function describeFailureReport(report: FailureReport) {
  const parts: string[] = [];
  if (report.primaryModel)
    parts.push(
      `Primary ${safe(report.primaryModel)}: ${safe(report.primaryFailure) ?? "not attempted"}`,
    );
  if (report.fallbackModel)
    parts.push(
      `Fallback ${safe(report.fallbackModel)}: ${safe(report.fallbackFailure) ?? "not attempted"}`,
    );
  if (!parts.length) return `Final: ${safe(report.finalFailure) ?? "unknown"}`;
  return parts.join(" / ");
}

/** A copy safe for persistence in model_calls.response_metadata. */
export function persistableFailureReport(report: FailureReport) {
  return {
    primaryModel: safe(report.primaryModel),
    primaryFailure: safe(report.primaryFailure),
    fallbackModel: safe(report.fallbackModel),
    fallbackFailure: safe(report.fallbackFailure),
    finalFailure: safe(report.finalFailure),
    attempts: report.attempts.slice(0, 12).map((a) => ({
      model: safe(a.model),
      kind: a.kind,
      code: safe(a.code),
      ...(typeof a.status === "number" ? { status: a.status } : {}),
      ...(typeof a.retryAfterMs === "number"
        ? { retryAfterMs: a.retryAfterMs }
        : {}),
    })),
  };
}

/** response_metadata for a failed model call: the report, if any. */
export function failureMetadata(error: unknown): Record<string, unknown> {
  const report = failureReportOf(error);
  if (!report) return {};
  return {
    failureReport: persistableFailureReport(report),
    failureSummary: describeFailureReport(report),
  };
}
