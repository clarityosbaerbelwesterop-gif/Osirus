import { PromotionError, promote } from "../artifacts/states";
import {
  applyHeadGrad,
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
