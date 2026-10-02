import { promote, type ArtifactState } from "../artifacts/states";
import { judgePredictions } from "../evals/independent-judge";
import {
  applyHeadGrad,
  forwardTokens,
  initParams,
  meanNll,
  outputHeadGrad,
  rmsNorm,
} from "./architecture";
import { gradeArm } from "./behavior";
import {
  LOCKED_LOOP_SURFACES,
  type LockedSurface,
  type ModelProgram,
} from "./types";

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

export interface LoopReport {
  readonly loopId: string;
  readonly weakness: string;
  readonly hypothesis: string;
  readonly experimentId: string;
  readonly trainLoss: number;
  readonly holdoutPassed: boolean;
  readonly decision: "reject" | "hold";
  readonly artifactState: ArtifactState;
  readonly trainedModel: false;
  readonly production: false;
}

/**
 * One controlled loop on the CPU fixture.
 * It may record a hold or a reject. It cannot promote to production.
 */
export function runResearchLoop(
  program: ModelProgram,
  requestedChange?: LockedSurface,
): LoopReport {
  if (requestedChange) assertLoopMayNotTouch(requestedChange);
  const arm = program.arms[0];
  if (!arm) throw new Error("program has no arm to evaluate");
  const sample = arm.dataset.samples[0];
  const graded = sample
    ? gradeArm(arm.task.grader === "nll" ? "exact" : arm.task.grader, sample)
    : { passed: false, detail: "no sample" };
  const weakness = graded.passed
    ? "no fixture grader failure on the first sample"
    : graded.detail;
  const params = initParams(
    program.architecture.fixture,
    program.training.seed,
  );
  const tokens = [1, 2, 3];
  const targets = [2, 3, 1];
  const before = meanNll(forwardTokens(params, tokens).logits, targets);
  const hidden = rmsNorm(
    params.embed.slice(
      tokens[0]! * params.arch.dim,
      (tokens[0]! + 1) * params.arch.dim,
    ),
  );
  const grad = outputHeadGrad(params, hidden, targets[0] ?? 0);
  const stepped = applyHeadGrad(params, grad, 0.05);
  const after = meanNll(forwardTokens(stepped, tokens).logits, targets);
  const steppedForward = forwardTokens(stepped, tokens);
  const rows = targets.map((target, index) => {
    const logits = steppedForward.logits[index] ?? [];
    let argmax = 0;
    for (let i = 1; i < logits.length; i += 1)
      if ((logits[i] ?? 0) > (logits[argmax] ?? 0)) argmax = i;
    return { id: `tok-${index}`, prediction: [argmax], target: [target] };
  });
  const holdout = judgePredictions(rows, 0);
  const regressed = after > before + 1e-6;
  let state: ArtifactState = "infrastructure_ready";
  state = promote(state, "training_ready");
  state = promote(state, "training_running");
  state = promote(state, "checkpoint_created");
  if (holdout.passed) state = promote(state, "checkpoint_validated");
  return {
    loopId: program.research.loopId,
    weakness,
    hypothesis: program.research.hypotheses[0] ?? "none",
    experimentId: program.training.experimentId,
    trainLoss: after,
    holdoutPassed: holdout.passed,
    decision: regressed ? "reject" : "hold",
    artifactState: state,
    trainedModel: false,
    production: false,
  };
}
