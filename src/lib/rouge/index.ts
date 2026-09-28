// Rouge model-system prototype (M56-M57): LEGACY RESEARCH.
//
// Rouge 1 is now a trained model -- a derivative of Qwen3.5-397B-A17B with
// its own checkpoints (docs/rouge/native-model.md, training/rouge/). This
// runtime (external cores, substitution ladder, multi-call kernel) stays for
// its useful parts -- the /api/rouge endpoint, telemetry, evaluation
// tooling -- and is not where Rouge's intelligence is built.
import { env } from "../env";
import type { CapacityPriority } from "../models/capacity";
import { coreSpec } from "./foundation";
import { LadderFoundation } from "./foundations/ladder";
import { UnoRouterFoundation } from "./foundations/unorouter";
import {
  DEFAULT_CORE,
  defaultPolicy,
  MEASURED_SUBSTITUTES,
  type RougePolicy,
} from "./policy";
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

/** Substitute cores, in order: ROUGE_SUBSTITUTE_CORES, else the measured list. */
export function substituteCores(core: string) {
  const configured = env.ROUGE_SUBSTITUTE_CORES?.split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  return [...new Set(configured ?? MEASURED_SUBSTITUTES)].filter(
    (id) => id !== core,
  );
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
  const rung = (id: string) =>
    new UnoRouterFoundation(coreSpec(id), { priority: options.priority });
  const substitutes =
    options.allowCoreSubstitute === false ? [] : substituteCores(core.id);
  return new RougeRuntime({
    foundation: new LadderFoundation([rung(core.id), ...substitutes.map(rung)]),
    policy: options.policy ?? defaultPolicy(core.id),
    telemetry: options.telemetry,
    allowCoreSubstitute: options.allowCoreSubstitute,
  });
}
