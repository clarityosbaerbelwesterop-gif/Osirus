import { env } from "../env";
import type { CapacityPriority } from "../models/capacity";
import { coreSpec } from "./foundation";
import { UnoRouterFoundation } from "./foundations/unorouter";
import { DEFAULT_CORE, defaultPolicy, type RougePolicy } from "./policy";
import { RougeRuntime } from "./runtime";
import type { RougeTelemetrySink } from "./telemetry";

export { RougeRuntime } from "./runtime";
export { coreSpec, CORES } from "./foundation";
export { defaultPolicy, versionOf } from "./policy";
export * from "./types";

/** The configured foundation core: ROUGE_CORE_MODEL, else grok-4.6. */
export function configuredCore() {
  return env.ROUGE_CORE_MODEL ?? DEFAULT_CORE;
}

/**
 * Rouge on its configured core, through UnoRouter. Interactive callers keep
 * the defaults (P0, substitute allowed and labelled); evaluations pass
 * `allowCoreSubstitute: false` and a lower priority.
 */
export function createRougeRuntime(
  options: {
    core?: string;
    policy?: RougePolicy;
    priority?: CapacityPriority;
    allowCoreSubstitute?: boolean;
    telemetry?: RougeTelemetrySink;
  } = {},
) {
  const core = coreSpec(
    options.core ?? options.policy?.core ?? configuredCore(),
  );
  return new RougeRuntime({
    foundation: new UnoRouterFoundation(core, { priority: options.priority }),
    policy: options.policy ?? defaultPolicy(core.id),
    telemetry: options.telemetry,
    allowCoreSubstitute: options.allowCoreSubstitute,
  });
}
