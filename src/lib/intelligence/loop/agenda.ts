import { supportsCapability } from "../curriculum/generator";
import { usefulnessOf } from "../capabilities/taxonomy";
import {
  DEFAULT_CALLS_PER_TRIAL,
  expectedGainPerCall,
} from "../governor/governor";
import type { IntelStore } from "../store/store";
import type { AgendaItem, Capability } from "../types";

// The ResearchAgenda: what the Foundry works on next, ranked by expected
// capability gain per model call. Only capabilities it can actually generate
// verified tasks for are research targets; the others stay on the map as
// "unmeasured" until a generator for them exists.

const TITLES: Record<string, string> = {
  "coding.debug": "Improve debugging of failing tests",
  "math.quantitative": "Improve quantitative reliability",
};

function weaknessOf(capability: Capability) {
  if (capability.verifiedSuccessRate === null) return 0.8; // unknown is worth measuring
  return 1 - capability.verifiedSuccessRate;
}

export async function refreshAgenda(store: IntelStore) {
  const capabilities = await store.listCapabilities();
  const existing = await store.listAgenda();
  const items: AgendaItem[] = [];
  for (const capability of capabilities) {
    if (!supportsCapability(capability.id)) continue;
    const weakness = weaknessOf(capability);
    const usefulness = usefulnessOf(capability.id);
    const tried = existing.find((item) => item.capabilityId === capability.id);
    // Potential starts at 1 and shrinks each time a cycle on the item finds
    // nothing (see the loop's "next" phase); a status change resets it.
    const statusChanged =
      tried && tried.components.weakness !== Number(weakness.toFixed(3));
    const potential = tried && !statusChanged ? tried.components.potential : 1;
    const trials = 20;
    const score = expectedGainPerCall({
      weakness,
      usefulness,
      potential,
      callsPerTrial: DEFAULT_CALLS_PER_TRIAL,
      trials,
    });
    items.push(
      await store.upsertAgendaItem({
        capabilityId: capability.id,
        title: TITLES[capability.id] ?? `Improve ${capability.name}`,
        rationale: `Verified rate ${capability.verifiedSuccessRate === null ? "unmeasured" : `${Math.round(capability.verifiedSuccessRate * 100)}%`} over ${capability.sampleCount} judged runs; usefulness ${usefulness}.`,
        score: Number(score.toFixed(4)),
        components: {
          weakness: Number(weakness.toFixed(3)),
          usefulness,
          potential: Number(potential.toFixed(3)),
          cost: DEFAULT_CALLS_PER_TRIAL * trials,
        },
        status:
          statusChanged && tried?.status === "parked"
            ? "open"
            : (tried?.status ?? "open"),
      }),
    );
  }
  return items.sort((a, b) => b.score - a.score);
}

/** The best open item, skipping the one just worked on when others exist. */
export function pickAgendaItem(
  items: AgendaItem[],
  avoidCapabilityId?: string | null,
) {
  const open = items.filter(
    (item) => item.status === "open" || item.status === "active",
  );
  const pool = open.length
    ? open
    : items.filter((item) => item.status !== "done");
  const others = pool.filter((item) => item.capabilityId !== avoidCapabilityId);
  return (
    (others.length ? others : pool).sort((a, b) => b.score - a.score)[0] ?? null
  );
}
