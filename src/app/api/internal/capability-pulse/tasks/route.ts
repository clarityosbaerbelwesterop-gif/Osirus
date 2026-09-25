import {
  coverage,
  pulseCatalog,
  suiteVersion,
} from "@/lib/agent/pulse/catalog";
import { CAPABILITY_LANES } from "@/lib/agent/pulse/lanes";
import { PgPulseStore } from "@/lib/agent/pulse/store";
import { isOperator } from "@/lib/intelligence/production/operator";
import { guardAction, json } from "@/lib/product/api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// The capability pulse, for operators: which tasks the suite has, which
// families and levels it covers, the latest cycles and the baseline cells.
// Tasks are code with their own graders, so there is nothing to register at
// runtime; the old registration endpoint stored descriptors no runner ever
// executed, and is gone.

export async function GET(request: Request) {
  const guard = await guardAction(request, {
    route: "capability-pulse.tasks",
    limit: 30,
  });
  if (!guard.ok) return guard.response;
  if (!(await isOperator(guard.identity.userId)))
    return json({ error: "not_found" }, 404);
  const specs = await pulseCatalog();
  const version = suiteVersion(specs);
  const store = new PgPulseStore();
  const [cycles, baselines] = await Promise.all([
    store.recentCycles(10).catch(() => []),
    store.baselines(version).catch(() => []),
  ]);
  return json({
    suiteVersion: version,
    coverage: coverage(specs, CAPABILITY_LANES),
    tasks: specs.map((spec) => ({
      id: spec.id,
      family: spec.family,
      level: spec.level,
      difficulty: spec.difficulty,
      mode: spec.mode,
      source: spec.source,
      title: spec.title,
    })),
    cycles,
    baselines,
  });
}
