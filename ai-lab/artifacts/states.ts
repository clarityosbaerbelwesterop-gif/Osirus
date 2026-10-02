/**
 * Artifact states for the AI Lab. They are distinct on purpose.
 * This milestone cannot enter production_candidate or production, and it
 * cannot record a model as trained. A tiny CPU fixture may reach
 * checkpoint_validated / holdout_passed only as an infrastructure proof.
 */

export const ARTIFACT_STATES = [
  "infrastructure_ready",
  "training_ready",
  "training_running",
  "checkpoint_created",
  "checkpoint_validated",
  "holdout_passed",
  "production_candidate",
  "production",
] as const;

export type ArtifactState = (typeof ARTIFACT_STATES)[number];

/** Hard lock for this milestone. Not an environment flag. */
export const MILESTONE_LOCK = {
  allowProduction: false,
  allowTrainedClaim: false,
} as const;

const NEXT: Record<ArtifactState, readonly ArtifactState[]> = {
  infrastructure_ready: ["training_ready"],
  training_ready: ["training_running"],
  training_running: ["checkpoint_created"],
  checkpoint_created: ["checkpoint_validated"],
  checkpoint_validated: ["holdout_passed"],
  holdout_passed: ["production_candidate"],
  production_candidate: ["production"],
  production: [],
};

export class PromotionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PromotionError";
  }
}

export function promote(from: ArtifactState, to: ArtifactState): ArtifactState {
  if (to === "production" || to === "production_candidate") {
    throw new PromotionError(
      `refusing ${to}: this milestone cannot mark a production candidate or production`,
    );
  }
  if (!NEXT[from].includes(to)) {
    throw new PromotionError(`illegal transition ${from} -> ${to}`);
  }
  return to;
}
