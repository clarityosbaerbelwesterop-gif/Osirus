import { redact } from "../security/redact";

// Verification.
//
// What this replaces: `assistant.trim().length > 0`. That check could only ever
// answer "did the model say something", and the runtime reported its answer as
// "verified". Every rule below exists to stop a claim of that shape being made
// again.
//
// The engine is deliberately free of I/O. Checks are supplied by the caller and
// may do whatever they need to; arbitration over their results is pure, so the
// rule that decides whether a run may be called verified is unit-testable
// without a database, a sandbox or a model.

export type CheckType =
  | "STRUCTURE"
  | "MODEL"
  | "TOOL"
  | "TEST"
  | "BUILD"
  | "SOURCE"
  | "MATH"
  | "SECURITY"
  | "COMPOSITE";

export type CheckStatus = "passed" | "failed" | "inconclusive";

/** Mirrors osirus.run_stages.verifier_status. */
export type VerdictStatus =
  "verified" | "rejected" | "conflicted" | "unverified";

export type CheckOutcome = {
  status: CheckStatus;
  detail: string;
  evidence?: Record<string, unknown>;
};

export type CheckResult = CheckOutcome & {
  id: string;
  type: CheckType;
  required: boolean;
  evidence: Record<string, unknown>;
  durationMs: number;
};

export type VerificationContext = {
  runId: string;
  stageId: string;
  objective: string;
  output: Record<string, unknown>;
  signal?: AbortSignal;
};

export type VerificationCheck = {
  id: string;
  type: CheckType;
  /** A required check that fails rejects the verdict outright. */
  required?: boolean;
  run(context: VerificationContext): Promise<CheckOutcome> | CheckOutcome;
};

export type Verdict = {
  status: VerdictStatus;
  summary: string;
  checks: CheckResult[];
};

/**
 * A model reviewing its own work is evidence of nothing the model did not
 * already believe. Every other check observes something outside the model:
 * a schema, an exit code, a fetched document, a solver.
 */
export function isDeterministic(type: CheckType) {
  return type !== "MODEL";
}

/**
 * The arbitration rule. Order matters, and each branch states the claim it
 * refuses to let the engine make.
 */
export function arbitrate(checks: CheckResult[]): Verdict {
  if (checks.length === 0) {
    return { status: "unverified", summary: "No checks ran.", checks };
  }

  const deterministic = checks.filter((check) => isDeterministic(check.type));
  const failedRequired = checks.filter(
    (check) => check.required && check.status === "failed",
  );
  const failedDeterministic = deterministic.filter(
    (check) => check.status === "failed",
  );
  const passedDeterministic = deterministic.filter(
    (check) => check.status === "passed",
  );
  const inconclusiveRequired = checks.filter(
    (check) => check.required && check.status === "inconclusive",
  );
  const failedModel = checks.filter(
    (check) => check.type === "MODEL" && check.status === "failed",
  );

  if (failedRequired.length > 0) {
    return {
      status: "rejected",
      summary: `Required check failed: ${failedRequired
        .map((check) => check.id)
        .join(", ")}.`,
      checks,
    };
  }

  // A failing deterministic check observed something real going wrong. It is
  // not downgraded to advisory just because nobody marked it required.
  if (failedDeterministic.length > 0) {
    return {
      status: "rejected",
      summary: `Evidence contradicts the result: ${failedDeterministic
        .map((check) => check.id)
        .join(", ")}.`,
      checks,
    };
  }

  if (inconclusiveRequired.length > 0) {
    return {
      status: "unverified",
      summary: `Required check could not reach a conclusion: ${inconclusiveRequired
        .map((check) => check.id)
        .join(", ")}.`,
      checks,
    };
  }

  // The ceiling. With no deterministic evidence there is nothing to verify
  // against, so a unanimous panel of model reviewers still tops out here.
  if (passedDeterministic.length === 0) {
    return {
      status: "unverified",
      summary:
        "No deterministic evidence was produced; model review alone cannot verify a result.",
      checks,
    };
  }

  if (failedModel.length > 0) {
    return {
      status: "conflicted",
      summary: `Deterministic checks passed but model review objected: ${failedModel
        .map((check) => check.id)
        .join(", ")}.`,
      checks,
    };
  }

  return {
    status: "verified",
    summary: `${passedDeterministic.length} deterministic check(s) passed.`,
    checks,
  };
}

function sanitize(evidence: Record<string, unknown>): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(evidence)) {
    output[key] =
      typeof value === "string"
        ? redact(value)
        : value === null || typeof value !== "object"
          ? value
          : sanitize(value as Record<string, unknown>);
  }
  return output;
}

export class VerificationEngine {
  constructor(private readonly checks: VerificationCheck[]) {}

  static of(...checks: Array<VerificationCheck | null | undefined>) {
    return new VerificationEngine(
      checks.filter((check): check is VerificationCheck => Boolean(check)),
    );
  }

  async run(context: VerificationContext): Promise<Verdict> {
    const results: CheckResult[] = [];
    for (const check of this.checks) {
      const startedAt = Date.now();
      let outcome: CheckOutcome;
      try {
        outcome = await check.run(context);
      } catch (error) {
        // A check that throws proved nothing. Treating the throw as a pass is
        // the failure mode this whole file exists to prevent.
        outcome = {
          status: "inconclusive",
          detail: redact(
            error instanceof Error ? error.message : "check_threw",
          ),
        };
      }
      results.push({
        id: check.id,
        type: check.type,
        required: check.required ?? false,
        status: outcome.status,
        detail: redact(outcome.detail).slice(0, 2000),
        evidence: sanitize(outcome.evidence ?? {}),
        durationMs: Date.now() - startedAt,
      });
    }
    return arbitrate(results);
  }
}
