import { PromotionError, promote } from "../artifacts/states";
import {
  applyHeadGrad,
  causalPrefixStable,
  forwardTokens,
  initParams,
  outputHeadGrad,
  rmsNorm,
  type FixtureArch,
  type FixtureParams,
} from "./architecture";
import { LOCKED_LOOP_SURFACES, type LockedSurface } from "./types";

export class LoopBoundaryError extends Error {
  constructor(surface: string) {
    super(`research loop cannot change ${surface}`);
    this.name = "LoopBoundaryError";
  }
}

export function assertLoopMayNotTouch(surface: string): void {
  if ((LOCKED_LOOP_SURFACES as readonly string[]).includes(surface)) {
    throw new LoopBoundaryError(surface);
  }
}

/** A fixture step may change only a finite output-head gradient, and only after this check. */
export function reviewFixtureStep(grad: readonly number[]): {
  readonly allowed: boolean;
  readonly reason: string;
} {
  if (grad.length === 0) return { allowed: false, reason: "empty step" };
  if (grad.some((value) => !Number.isFinite(value))) {
    return { allowed: false, reason: "non-finite gradient" };
  }
  return { allowed: true, reason: "head-only fixture step" };
}

export function applyReviewedHeadStep(input: {
  params: FixtureParams;
  grad: readonly number[];
  lr: number;
  lockedSurface?: string;
}): {
  readonly applied: boolean;
  readonly reason: string;
  readonly params: FixtureParams;
} {
  if (input.lockedSurface) assertLoopMayNotTouch(input.lockedSurface);
  const review = reviewFixtureStep(input.grad);
  if (!review.allowed) {
    return { applied: false, reason: review.reason, params: input.params };
  }
  return {
    applied: true,
    reason: review.reason,
    params: applyHeadGrad(input.params, input.grad, input.lr),
  };
}

const RSI_ARCH: FixtureArch = {
  family: "dense-rope",
  vocab: 8,
  dim: 4,
  heads: 2,
  kvHeads: 1,
  ffn: 8,
  experts: 1,
  context: 8,
  precision: "fp64-fixture",
};

function headsEqual(left: FixtureParams, right: FixtureParams): boolean {
  return (
    left.head.length === right.head.length &&
    left.head.every((value, index) => value === right.head[index])
  );
}

/**
 * Review-before-apply on the CPU fixture.
 * Empty and non-finite gradients are not applied. Locked surfaces throw.
 * Production promotion throws. This does not train a model.
 */
export function gradeRsiSample(sample: { input: string; target: string }): {
  passed: boolean;
  detail: string;
} {
  const params = initParams(RSI_ARCH, 11);
  const hidden = rmsNorm(params.embed.slice(0, RSI_ARCH.dim));
  if (sample.input === "production" || sample.input === "candidate") {
    const to =
      sample.input === "production" ? "production" : "production_candidate";
    try {
      promote("holdout_passed", to);
      return { passed: false, detail: `${to} promotion did not throw` };
    } catch (error) {
      const passed =
        error instanceof PromotionError && sample.target === "threw";
      return {
        passed,
        detail:
          error instanceof PromotionError
            ? error.message
            : "not a promotion error",
      };
    }
  }
  if (sample.input.startsWith("locked:")) {
    const surface = sample.input.slice("locked:".length);
    try {
      applyReviewedHeadStep({
        params,
        grad: [0.1],
        lr: 0.05,
        lockedSurface: surface,
      });
      return { passed: false, detail: "locked surface did not throw" };
    } catch (error) {
      const passed =
        error instanceof LoopBoundaryError && sample.target === "threw";
      return {
        passed,
        detail: error instanceof Error ? error.message : "throw",
      };
    }
  }
  if (sample.input === "empty") {
    const result = applyReviewedHeadStep({ params, grad: [], lr: 0.05 });
    const passed =
      !result.applied &&
      headsEqual(params, result.params) &&
      sample.target === "not-applied";
    return { passed, detail: result.reason };
  }
  if (sample.input === "nan" || sample.input === "infinite") {
    const grad =
      sample.input === "nan" ? [Number.NaN] : [Number.POSITIVE_INFINITY];
    const result = applyReviewedHeadStep({ params, grad, lr: 0.05 });
    const passed =
      !result.applied &&
      headsEqual(params, result.params) &&
      sample.target === "not-applied";
    return { passed, detail: result.reason };
  }
  if (sample.input === "finite") {
    const grad = outputHeadGrad(params, hidden, 1);
    if (grad.every((value) => value === 0)) {
      return { passed: false, detail: "zero gradient is not a reviewed step" };
    }
    const result = applyReviewedHeadStep({ params, grad, lr: 0.05 });
    const passed =
      result.applied &&
      !headsEqual(params, result.params) &&
      sample.target === "applied";
    return { passed, detail: result.reason };
  }
  return { passed: false, detail: "unknown rsi fixture" };
}

export function isLockedSurface(value: string): value is LockedSurface {
  return (LOCKED_LOOP_SURFACES as readonly string[]).includes(value);
}

/**
 * Review-before-apply on this program's own CPU fixture, not a shared stand-in.
 * Empty and non-finite gradients are not applied. Locked surfaces and production throw.
 */
export function reviewProgramFixture(input: {
  arch: FixtureArch;
  seed: number;
}): { passed: boolean; detail: string } {
  const params = initParams(input.arch, input.seed);
  const hidden = rmsNorm(
    params.embed.slice(input.arch.dim, input.arch.dim * 2),
  );
  const grad = outputHeadGrad(params, hidden, 2);
  const empty = applyReviewedHeadStep({ params, grad: [], lr: 0.05 });
  const toxic = applyReviewedHeadStep({
    params,
    grad: [Number.NaN],
    lr: 0.05,
  });
  if (
    empty.applied ||
    toxic.applied ||
    !headsEqual(params, empty.params) ||
    !headsEqual(params, toxic.params)
  ) {
    return { passed: false, detail: "a refused gradient was applied" };
  }
  try {
    applyReviewedHeadStep({
      params,
      grad: [0.1],
      lr: 0.05,
      lockedSurface: "trust_root",
    });
    return { passed: false, detail: "locked surface did not throw" };
  } catch (error) {
    if (!(error instanceof LoopBoundaryError)) {
      return { passed: false, detail: "locked surface threw the wrong error" };
    }
  }
  try {
    promote("holdout_passed", "production");
    return { passed: false, detail: "production promotion did not throw" };
  } catch (error) {
    if (!(error instanceof PromotionError)) {
      return { passed: false, detail: "production threw the wrong error" };
    }
  }
  if (grad.every((value) => value === 0)) {
    return { passed: false, detail: "zero gradient is not a reviewed step" };
  }
  const reviewed = applyReviewedHeadStep({ params, grad, lr: 0.05 });
  if (!reviewed.applied || headsEqual(params, reviewed.params)) {
    return { passed: false, detail: "finite head step was not applied" };
  }
  const tokens = [1, 2, 3];
  const stepped = forwardTokens(reviewed.params, tokens);
  const finite = stepped.logits.every((row) =>
    row.every((value) => Number.isFinite(value)),
  );
  if (!finite || !causalPrefixStable(reviewed.params, tokens)) {
    return { passed: false, detail: "fixture broke after the reviewed step" };
  }
  if (input.arch.family === "fim-causal") {
    const filled = forwardTokens(reviewed.params, tokens, { fimMiddleFrom: 1 });
    const changed = (filled.logits[2] ?? []).some(
      (value, index) => value !== (stepped.logits[2] ?? [])[index],
    );
    if (!changed) {
      return {
        passed: false,
        detail: "fim span did not change on this fixture",
      };
    }
  }
  if (input.arch.family === "routed-dense") {
    const gates = stepped.route[0] ?? [];
    const sum = gates.reduce((total, value) => total + value, 0);
    if (
      gates.length !== input.arch.experts ||
      Math.abs(sum - 1) > 1e-9 ||
      gates.some((value) => !Number.isFinite(value))
    ) {
      return {
        passed: false,
        detail: "router simplex broke after the reviewed step",
      };
    }
  }
  return {
    passed: true,
    detail: `${input.arch.family} head step reviewed on this fixture`,
  };
}
