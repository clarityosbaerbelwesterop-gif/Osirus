export * from "./types";
export * from "./cloner";
export * from "./self-improver";
export * from "./code-loop";

import { RougeCodeLoopEngine, type RougeCodeLoopInput } from "./code-loop";
import type { RougeAgentConfig, RougeAgentRunResult } from "./types";

/**
 * Pre-Rouge Release Autonomous "Rouge Agent"
 *
 * Combines:
 * - Multi-role parallel self-cloning (`RougeSelfCloner`)
 * - Unbounded checkpointed code-verify-repair loops (`RougeCodeLoopEngine`)
 * - Recursive skill & strategy self-improvement (`RougeSkillSelfImprover`)
 */
export class RougeAgent {
  private readonly engine = new RougeCodeLoopEngine();

  constructor(private readonly defaultConfig: RougeAgentConfig = {}) {}

  async execute(input: RougeCodeLoopInput): Promise<RougeAgentRunResult> {
    return this.engine.run({
      ...input,
      config: { ...this.defaultConfig, ...input.config },
    });
  }

  async executeUntilPerfect(
    input: RougeCodeLoopInput & { maxContinuations?: number },
  ): Promise<RougeAgentRunResult> {
    return this.engine.runUntilPerfect({
      ...input,
      config: { ...this.defaultConfig, ...input.config },
    });
  }
}

export function createRougeAgent(config?: RougeAgentConfig): RougeAgent {
  return new RougeAgent(config);
}
