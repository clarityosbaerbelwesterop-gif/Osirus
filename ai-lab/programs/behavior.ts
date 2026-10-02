import { evalIntegerExpr, gradeDomain, type DomainGrader } from "./domains";
import type { ArmGrader } from "./types";

/** Behavior is enforced in graders and inference policy, not only a prompt. */

export function forbidsTrainedClaim(text: string, name: string): string | null {
  const pattern = new RegExp(`trained ${name}|i am (a )?${name}`, "i");
  if (pattern.test(text)) return `text claims a trained ${name} model`;
  return null;
}

export function staticSecurityScan(source: string): string[] {
  const findings: string[] = [];
  if (/\beval\s*\(/.test(source)) findings.push("eval-call");
  if (/child_process|os\.system|subprocess/.test(source))
    findings.push("process-spawn");
  if (/pickle\.loads/.test(source)) findings.push("pickle-load");
  if (/innerHTML|document\.write|dangerouslySetInnerHTML/.test(source))
    findings.push("html-sink");
  if (/\bnew\s+Function\s*\(/.test(source)) findings.push("dynamic-code");
  if (/(?:api[_-]?key|password|secret)\s*[:=]\s*['"][^'"]+['"]/i.test(source)) {
    findings.push("hardcoded-credential");
  }
  return findings;
}

export function applyLiteralPatch(
  source: string,
  from: string,
  to: string,
): string {
  if (!source.includes(from)) throw new Error("patch context was not found");
  return source.replace(from, to);
}

/** Runs each assert:expr=value clause. Unmet and malformed are recorded only after the run. */
export function runAssertionFixture(script: string): {
  readonly ran: true;
  readonly detail: "met" | "unmet" | "malformed";
} {
  const parts = script
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  if (parts.length === 0 || parts.some((part) => !part.startsWith("assert:"))) {
    return { ran: true, detail: "malformed" };
  }
  for (const part of parts) {
    const body = part.slice("assert:".length);
    const eq = body.lastIndexOf("=");
    if (eq <= 0) return { ran: true, detail: "malformed" };
    const result = evalIntegerExpr(body.slice(0, eq));
    const expected = body.slice(eq + 1).trim();
    if (!result.ok || String(result.value) !== expected) {
      return { ran: true, detail: "unmet" };
    }
  }
  return { ran: true, detail: "met" };
}

export function runArithmeticFixture(): { passed: number; failed: number } {
  const add = (a: number, b: number) => a + b;
  const cases: [number, number, number][] = [
    [1, 2, 3],
    [0, 0, 0],
    [-1, 1, 0],
  ];
  let passed = 0;
  let failed = 0;
  for (const [a, b, expected] of cases) {
    if (add(a, b) === expected) passed += 1;
    else failed += 1;
  }
  return { passed, failed };
}

/** Known median, not a model-supplied program. */
export function executeMedian(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0)
    return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
  return sorted[mid] ?? 0;
}

/** Same fixture cases before and after a literal patch. Not a coverage percentage. */
export function behavioralRegression(
  before: string,
  after: string,
): { changed: boolean; stillMedian: boolean } {
  const sample = [1, 2, 3, 4];
  const still = executeMedian(sample) === 2.5;
  return { changed: before !== after, stillMedian: still };
}

const DOMAIN_GRADERS = new Set<DomainGrader>([
  "entail",
  "math-expr",
  "logic",
  "formula",
  "sum",
  "citation",
  "context-bound",
  "memory",
  "independent",
  "plan",
  "horizon",
  "thinking",
  "terminal",
  "rsi",
  "database",
  "dry-run",
  "tool",
  "world",
  "multimodal",
  "repository",
  "graph",
  "strategy",
]);

export function gradeArm(
  grader: ArmGrader,
  sample: { input: string; target: string },
): { passed: boolean; detail: string } {
  if (DOMAIN_GRADERS.has(grader as DomainGrader)) {
    return gradeDomain(grader as DomainGrader, sample);
  }
  if (grader === "exact") {
    const passed = sample.input.trim() === sample.target.trim();
    return { passed, detail: passed ? "exact match" : "not an exact match" };
  }
  if (grader === "static-scan") {
    const findings = staticSecurityScan(sample.input);
    const passed = findings.length === Number(sample.target);
    return {
      passed,
      detail: findings.length ? findings.join(",") : "no findings",
    };
  }
  if (grader === "patch") {
    const [from, to, expected] = sample.target.split("=>");
    if (!from || !to || expected === undefined)
      return { passed: false, detail: "patch target malformed" };
    try {
      const next = applyLiteralPatch(sample.input, from, to);
      return {
        passed: next === expected,
        detail: next === expected ? "patch matched" : "patch mismatch",
      };
    } catch (error) {
      return {
        passed: false,
        detail: error instanceof Error ? error.message : "patch failed",
      };
    }
  }
  if (grader === "unit") {
    if (sample.input.includes("assert:")) {
      const result = runAssertionFixture(sample.input);
      const verdict =
        result.detail === "met"
          ? "pass"
          : result.detail === "unmet"
            ? "fail"
            : "malformed";
      return {
        passed: result.ran === true && verdict === sample.target,
        detail: `${verdict} after run`,
      };
    }
    const result = runArithmeticFixture();
    const passed =
      result.failed === 0 && String(result.passed) === sample.target;
    return {
      passed,
      detail: `${result.passed} passed, ${result.failed} failed`,
    };
  }
  if (grader === "execute") {
    const values = sample.input.split(",").map((part) => Number(part.trim()));
    if (values.some((value) => Number.isNaN(value)))
      return { passed: false, detail: "non-numeric fixture" };
    const got = executeMedian(values);
    const passed = String(got) === sample.target;
    return { passed, detail: `median=${got}` };
  }
  if (grader === "regression") {
    const result = behavioralRegression(sample.input, sample.target);
    const passed = result.changed && result.stillMedian;
    return {
      passed,
      detail: `changed=${result.changed}; median fixture ${result.stillMedian ? "held" : "broke"}`,
    };
  }
  return {
    passed: false,
    detail: "nll is scored by the fixture trainer, not this grader",
  };
}
