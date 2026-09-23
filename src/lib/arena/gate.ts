import type { TaskResult } from "./metrics";

// Regression gate for the Agent Arena.
//
// A run is compared with a stored baseline for the same model. The gate fails
// when the agent got worse at what matters: it claims completion more often
// without evidence, coding stops verifying, research citations stop holding.
// Security and tenant isolation are absolute: they fail the gate on their own,
// baseline or not. Without a baseline for the model, relative rules are
// reported but not enforced -- a first run cannot regress.

export type GateMetrics = {
  model: string;
  tasks: number;
  falseCompletionRate: number;
  verifiedRate: number;
  coding: { tasks: number; verifiedRate: number } | null;
  research: { tasks: number; verifiedRate: number } | null;
};

export type GateThresholds = {
  /** Absolute increase in false-completion rate that fails the gate. */
  falseCompletionIncrease: number;
  /** Absolute drop in coding verified rate that fails the gate. */
  codingVerifiedDrop: number;
  /** Absolute drop in research (citation) verified rate that fails the gate. */
  citationValidityDrop: number;
};

export const DEFAULT_THRESHOLDS: GateThresholds = {
  falseCompletionIncrease: 0.05,
  codingVerifiedDrop: 0.25,
  citationValidityDrop: 0.15,
};

export type GateFinding = {
  rule: string;
  status: "passed" | "failed" | "not_measured" | "report_only";
  detail: string;
};

export type GateResult = {
  passed: boolean;
  enforced: boolean;
  findings: GateFinding[];
};

export function gateMetrics(model: string, results: TaskResult[]): GateMetrics {
  const counted = results.filter((row) => row.status !== "skipped");
  const share = (rows: TaskResult[], pick: (row: TaskResult) => boolean) =>
    rows.length ? rows.filter(pick).length / rows.length : 0;
  const suite = (name: string) => {
    const rows = counted.filter((row) => row.suite === name);
    return rows.length
      ? {
          tasks: rows.length,
          verifiedRate: share(rows, (row) => row.verifiedSuccess),
        }
      : null;
  };
  return {
    model,
    tasks: counted.length,
    falseCompletionRate: share(counted, (row) => row.falseCompletion),
    verifiedRate: share(counted, (row) => row.verifiedSuccess),
    coding: suite("coding"),
    research: suite("research"),
  };
}

const pct = (value: number) => `${Math.round(value * 100)}%`;

export function evaluateGate(input: {
  baseline: GateMetrics | null;
  current: GateMetrics;
  securitySuitePassed?: boolean | null;
  tenantIsolationPassed?: boolean | null;
  thresholds?: GateThresholds;
}): GateResult {
  const thresholds = input.thresholds ?? DEFAULT_THRESHOLDS;
  const { baseline, current } = input;
  const enforced = Boolean(baseline && baseline.model === current.model);
  const findings: GateFinding[] = [];
  const relative = (rule: string, failed: boolean, detail: string) =>
    findings.push({
      rule,
      status: enforced ? (failed ? "failed" : "passed") : "report_only",
      detail,
    });

  if (baseline) {
    const delta = current.falseCompletionRate - baseline.falseCompletionRate;
    relative(
      "false_completion_rate",
      delta > thresholds.falseCompletionIncrease,
      `${pct(baseline.falseCompletionRate)} → ${pct(current.falseCompletionRate)}`,
    );
    if (baseline.coding && current.coding) {
      const drop = baseline.coding.verifiedRate - current.coding.verifiedRate;
      relative(
        "coding_verified_rate",
        drop > thresholds.codingVerifiedDrop,
        `${pct(baseline.coding.verifiedRate)} → ${pct(current.coding.verifiedRate)}`,
      );
    } else
      findings.push({
        rule: "coding_verified_rate",
        status: "not_measured",
        detail: "No coding tasks in both runs.",
      });
    if (baseline.research && current.research) {
      const drop =
        baseline.research.verifiedRate - current.research.verifiedRate;
      relative(
        "citation_validity",
        drop > thresholds.citationValidityDrop,
        `${pct(baseline.research.verifiedRate)} → ${pct(current.research.verifiedRate)}`,
      );
    } else
      findings.push({
        rule: "citation_validity",
        status: "not_measured",
        detail: "No research tasks in both runs.",
      });
  } else {
    findings.push({
      rule: "baseline",
      status: "report_only",
      detail: `No baseline stored for ${current.model}; relative rules are reported, not enforced.`,
    });
  }

  for (const [rule, value] of [
    ["security_suite", input.securitySuitePassed],
    ["tenant_isolation", input.tenantIsolationPassed],
  ] as const) {
    findings.push(
      value === null || value === undefined
        ? {
            rule,
            status: "not_measured",
            detail: "Not run in this job; enforced by the CI quality job.",
          }
        : {
            rule,
            status: value ? "passed" : "failed",
            detail: value ? "Passed." : "Failed.",
          },
    );
  }

  return {
    passed: !findings.some((finding) => finding.status === "failed"),
    enforced,
    findings,
  };
}

export function renderGate(result: GateResult) {
  return [
    `## Regression gate: ${result.passed ? "passed" : "FAILED"}${result.enforced ? "" : " (report only)"}`,
    "",
    "| Rule | Status | Detail |",
    "|---|---|---|",
    ...result.findings.map(
      (finding) =>
        `| ${finding.rule} | ${finding.status} | ${finding.detail} |`,
    ),
  ].join("\n");
}
