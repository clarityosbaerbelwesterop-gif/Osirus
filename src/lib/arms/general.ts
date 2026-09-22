import type { ModelRole } from "../models/provider";
import type { Capability } from "../runtime/types";
import { BaseArm } from "./base";
import type { ArmId } from "./types";

/**
 * The fallback. It always returns a low but non-zero confidence, so routing
 * has a defined answer for an objective no specialised arm recognises.
 */
export class GeneralArm extends BaseArm {
  readonly id: ArmId = "general";

  canHandle(): number {
    return 0.15;
  }

  protected primaryCapability(): Capability {
    return "general";
  }

  protected modelRole(): ModelRole {
    return "STRONG";
  }

  protected answerDirectives(): string[] {
    return [
      "Answer the question directly, then add only the context that changes what the reader would do.",
      "If the objective is ambiguous, answer the most likely reading and name the assumption.",
    ];
  }
}
