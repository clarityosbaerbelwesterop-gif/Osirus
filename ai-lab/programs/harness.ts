import { promote } from "../artifacts/states";
import {
  causalPrefixStable,
  forwardTokens,
  initParams,
  rope,
} from "./architecture";
import { forbidsTrainedClaim, gradeArm, staticSecurityScan } from "./behavior";
import { domainOf, uncoveredDomains } from "./domains";
import { gradeRsiSample } from "./rsi";
import type { ModelId, ModelProgram } from "./types";

/**
 * Per-program eval harness. Rows are pass/fail fixture checks.
 * `measured` stays false: this is not a benchmark score.
 */

export interface HarnessRow {
  readonly modelId: ModelId;
  readonly domain: string;
  readonly armId: string | null;
  readonly passed: boolean;
  readonly detail: string;
  readonly measured: false;
}

export interface HarnessReport {
  readonly modelId: ModelId;
  readonly measured: false;
  readonly trained: false;
  readonly rows: readonly HarnessRow[];
}

function row(
  program: ModelProgram,
  domain: string,
  passed: boolean,
  detail: string,
  armId: string | null = null,
): HarnessRow {
  return {
    modelId: program.id,
    domain,
    armId,
    passed,
    detail,
    measured: false,
  };
}

export function runCpuFixture(program: ModelProgram): readonly HarnessRow[] {
  const params = initParams(
    program.architecture.fixture,
    program.training.seed,
  );
  const tokens = [1, 2, 3];
  const forward = forwardTokens(params, tokens);
  const finite = forward.logits.every((logits) =>
    logits.every((value) => Number.isFinite(value)),
  );
  const rows: HarnessRow[] = [
    row(
      program,
      "cpu-forward",
      finite && forward.logits.length === tokens.length,
      finite ? "finite logits" : "non-finite logits",
    ),
    row(
      program,
      "cpu-causal",
      causalPrefixStable(params, tokens),
      "prefix logits ignore a later token",
    ),
  ];
  if (program.architecture.fixture.family === "dense-rope") {
    const vector = params.embed.slice(0, program.architecture.fixture.dim);
    rows.push(
      row(
        program,
        "cpu-rope",
        rope(vector, 0).some(
          (value, index) => value !== rope(vector, 1)[index],
        ),
        "rope position changes the vector",
      ),
    );
  }
  if (program.architecture.fixture.family === "fim-causal") {
    const plain = forwardTokens(params, tokens);
    const filled = forwardTokens(params, tokens, { fimMiddleFrom: 1 });
    const changed = (filled.logits[2] ?? []).some(
      (value, index) => value !== (plain.logits[2] ?? [])[index],
    );
    rows.push(
      row(program, "cpu-fim", changed, "middle span mixes the suffix anchor"),
    );
  }
  if (program.architecture.fixture.family === "routed-dense") {
    const gates = forward.route[0] ?? [];
    const sum = gates.reduce((total, value) => total + value, 0);
    rows.push(
      row(
        program,
        "cpu-router",
        gates.length === program.architecture.fixture.experts &&
          Math.abs(sum - 1) < 1e-9 &&
          gates.every((value) => Number.isFinite(value)),
        "router gates are a finite simplex",
      ),
    );
  }
  const production = gradeRsiSample({ input: "production", target: "threw" });
  rows.push(row(program, "rsi", production.passed, production.detail, null));
  let promotionThrew = false;
  try {
    promote("checkpoint_validated", "production_candidate");
  } catch {
    promotionThrew = true;
  }
  rows.push(
    row(
      program,
      "promotion",
      promotionThrew,
      promotionThrew
        ? "production_candidate promotion threw"
        : "production promotion did not throw",
    ),
  );
  return rows;
}

export function runProgramHarness(program: ModelProgram): HarnessReport {
  const rows: HarnessRow[] = [];
  const missing = uncoveredDomains(program);
  rows.push(
    row(
      program,
      "coverage",
      missing.length === 0,
      missing.length
        ? `missing ${missing.join(",")}`
        : "core and neighbor domains present",
    ),
  );
  for (const arm of program.arms) {
    if (arm.training.executable !== false) {
      rows.push(
        row(
          program,
          domainOf(arm.id),
          false,
          "arm training must stay off",
          arm.id,
        ),
      );
    }
    for (const sample of arm.dataset.samples) {
      const graded = gradeArm(arm.task.grader, sample);
      rows.push(
        row(program, domainOf(arm.id), graded.passed, graded.detail, arm.id),
      );
    }
  }
  rows.push(...runCpuFixture(program));
  return {
    modelId: program.id,
    measured: false,
    trained: false,
    rows,
  };
}

/** Structural observations about an authored sketch. Not a benchmark percentage. */
export function observeSketch(
  program: ModelProgram,
  text: string,
): readonly HarnessRow[] {
  const lowered = text.toLowerCase();
  const rows: HarnessRow[] = [];
  for (const needle of ["contact", "pipeline", "note"]) {
    rows.push(
      row(
        program,
        "crm",
        lowered.includes(needle),
        lowered.includes(needle) ? `mentions ${needle}` : `missing ${needle}`,
      ),
    );
  }
  const findings = staticSecurityScan(text);
  rows.push(
    row(
      program,
      "cybersecurity",
      findings.length === 0,
      findings.length ? findings.join(",") : "no findings",
    ),
  );
  const claim = forbidsTrainedClaim(text, program.displayName);
  const identity = /\b(AGI|ASI)\b/.test(text);
  rows.push(
    row(
      program,
      "safety",
      !claim && !identity,
      claim ?? (identity ? "identity claim" : "no trained or identity claim"),
    ),
  );
  const html = /<h1[\s>]/i.test(text);
  rows.push(row(program, "html", html, html ? "h1 present" : "no h1"));
  return rows;
}
