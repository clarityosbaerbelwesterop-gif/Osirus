import "server-only";
import { querySystem } from "../db/client";
import {
  bucketOf,
  CHAMPION_BASELINE,
  parsePolicy,
  type RuntimePolicy,
} from "./runtime";

// Which strategy version a product run is planned with.
//
// The only synchronous touch the Intelligence Plane has on a user request:
// one small read, cached for a minute, with a short timeout. Any failure --
// schema not migrated yet, database slow, Foundry disabled -- returns the
// baseline, so the Product Plane never waits on or breaks because of the
// Foundry.

type Candidate = {
  id: string;
  label: string;
  genome: unknown;
  status: "active" | "canary";
  canaryPercent: number;
};

const CACHE_MS = 60_000;
const TIMEOUT_MS = 800;
const cache = new Map<string, { at: number; candidates: Candidate[] }>();

async function candidatesFor(armId: string): Promise<Candidate[]> {
  const hit = cache.get(armId);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.candidates;
  const query = querySystem<{
    id: string;
    strategy_id: string;
    version: number;
    genome: unknown;
    status: "active" | "canary";
    canary_percent: number;
  }>(
    `select v.id, v.strategy_id, v.version, v.genome, v.status, v.canary_percent
       from osirus_intel.strategy_versions v
       join osirus_intel.strategies s on s.id = v.strategy_id
       join osirus_intel.settings st on st.id = 1
      where s.kind = $1
        and v.status in ('active', 'canary')
        and v.risk_class = 'low'
        and coalesce((st.flags ->> 'intelligencePlane')::boolean, false)
        and (v.status = 'active'
             or coalesce((st.flags ->> 'autoCanary')::boolean, false))
      order by v.status desc, v.updated_at desc
      limit 4`,
    [armId],
  );
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error("policy_timeout")), TIMEOUT_MS),
  );
  let candidates: Candidate[] = [];
  try {
    const rows = await Promise.race([query, timeout]);
    candidates = rows.map((row) => ({
      id: row.id,
      label: `${row.strategy_id} v${row.version}`,
      genome: row.genome,
      status: row.status,
      canaryPercent: Math.max(0, Math.min(100, Number(row.canary_percent))),
    }));
  } catch {
    candidates = [];
  }
  cache.set(armId, { at: Date.now(), candidates });
  return candidates;
}

export function choosePolicy(
  candidates: Candidate[],
  runId: string,
): RuntimePolicy {
  const bucket = bucketOf(runId);
  const canary = candidates.find(
    (candidate) =>
      candidate.status === "canary" && bucket < candidate.canaryPercent,
  );
  const chosen =
    canary ?? candidates.find((candidate) => candidate.status === "active");
  if (!chosen) return CHAMPION_BASELINE;
  return parsePolicy({
    strategyVersionId: chosen.id,
    label: chosen.label,
    genome: chosen.genome,
    assignment: chosen === canary ? "canary" : "champion",
  });
}

export async function resolveProductPolicy(input: {
  armId: string;
  runId: string;
}): Promise<RuntimePolicy> {
  try {
    return choosePolicy(await candidatesFor(input.armId), input.runId);
  } catch {
    return CHAMPION_BASELINE;
  }
}

/** Drop cached lookups, e.g. after a promotion in the same process. */
export function clearPolicyCache() {
  cache.clear();
}
