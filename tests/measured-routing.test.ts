import { describe, expect, it } from "vitest";
import {
  measuredPenalty,
  rankByMeasure,
  type MeasuredStat,
} from "../src/lib/gateway/measured";

// Live 2026-11-04 (14 days of Rouge decisions): the free OpenRouter route of
// nemotron-3-ultra took 19 s on average, the NVIDIA route of the same model
// 2.7 s. The run's model must follow what was measured.

const FREE_ROUTE = "openrouter:nvidia/nemotron-3-ultra-550b-a55b:free";
const DIRECT = "nvidia:nvidia/nemotron-3-ultra-550b-a55b";

describe("measured model ranking", () => {
  it("penalizes slow and failing models, not unmeasured ones", () => {
    expect(measuredPenalty(undefined)).toBe(0);
    expect(measuredPenalty({ calls: 2, failed: 2, p50Ms: 60_000 })).toBe(0);
    expect(measuredPenalty({ calls: 75, failed: 0, p50Ms: 2_700 })).toBe(0);
    expect(measuredPenalty({ calls: 75, failed: 0, p50Ms: 12_000 })).toBe(10);
    expect(measuredPenalty({ calls: 75, failed: 0, p50Ms: 25_000 })).toBe(20);
    expect(measuredPenalty({ calls: 10, failed: 5, p50Ms: 1_000 })).toBe(15);
  });

  it("puts the fast route of the same model ahead of the slow free one", () => {
    const stats = new Map<string, MeasuredStat>([
      [FREE_ROUTE, { calls: 75, failed: 5, p50Ms: 14_000 }],
      [DIRECT, { calls: 4, failed: 0, p50Ms: 2_700 }],
    ]);
    const ranked = rankByMeasure(
      [{ ref: FREE_ROUTE }, { ref: DIRECT }, { ref: "nvidia:other" }],
      stats,
    );
    expect(ranked.map((model) => model.ref)).toEqual([
      DIRECT,
      "nvidia:other",
      FREE_ROUTE,
    ]);
  });

  it("keeps the given order when nothing was measured", () => {
    const models = [{ ref: "a" }, { ref: "b" }, { ref: "c" }];
    expect(rankByMeasure(models, new Map())).toEqual(models);
  });
});
