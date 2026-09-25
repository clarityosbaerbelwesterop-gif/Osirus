import {
  nextEscalation,
  RUNG_CALLS,
  RUNG_REPAIR_PRIOR,
  startTier,
} from "../../agent/escalation";
import { rng, seedOf } from "../evals/random";

// The ADAPTIVE_COMPUTE pulse family (M47). Deterministic checks of the
// escalation policy: static compute is today's behaviour, a verified draft
// is never escalated, the rung chosen is the best expected gain per call
// that fits, learned vetoes hold -- and, on a seeded simulated population
// under the policy's own priors, adaptive compute spends fewer calls per
// verified result than always forming a team. The simulation checks the
// policy's arithmetic, not the model: live paired trials decide whether it
// pays on real tasks.

export type ComputeCheck = {
  level: 1 | 2 | 3 | 4 | 5;
  title: string;
  check(): { held: boolean; detail: string };
};

const draft = (
  verification: "unverified" | "partial" | "verified" | "rejected",
  remainingCalls = 8,
) => ({ verification, openHypotheses: 0, remainingCalls, armId: "general" });

export function simulate(seed: string, drafts = 400) {
  const random = rng(seedOf(seed));
  const states = ["verified", "partial", "unverified", "rejected"] as const;
  const policies = {
    single: { verified: 0, calls: 0 },
    alwaysTeam: { verified: 0, calls: 0 },
    adaptive: { verified: 0, calls: 0 },
  };
  for (let index = 0; index < drafts; index += 1) {
    const state = states[Math.min(3, Math.floor(random.next() * 4))]!;
    const verifiedAlready = state === "verified";
    const roll = random.next();
    const draftCalls = 3;
    const repaired = (rung: keyof typeof RUNG_REPAIR_PRIOR) =>
      roll < RUNG_REPAIR_PRIOR[rung];
    policies.single.calls += draftCalls;
    policies.single.verified += verifiedAlready ? 1 : 0;
    policies.alwaysTeam.calls += draftCalls + RUNG_CALLS.team;
    policies.alwaysTeam.verified += verifiedAlready || repaired("team") ? 1 : 0;
    const decision = nextEscalation({
      genome: { compute: { mode: "adaptive" } },
      ...draft(state),
    });
    policies.adaptive.calls +=
      draftCalls + (decision.rung ? RUNG_CALLS[decision.rung] : 0);
    policies.adaptive.verified +=
      verifiedAlready || (decision.rung ? repaired(decision.rung) : false)
        ? 1
        : 0;
  }
  const perVerified = (entry: { verified: number; calls: number }) =>
    entry.verified ? entry.calls / entry.verified : Infinity;
  return {
    policies,
    callsPerVerified: {
      single: perVerified(policies.single),
      alwaysTeam: perVerified(policies.alwaysTeam),
      adaptive: perVerified(policies.adaptive),
    },
  };
}

export const COMPUTE_CHECKS: ComputeCheck[] = [
  {
    level: 1,
    title: "static compute is today's behaviour",
    check() {
      const tiers = [
        startTier({}, "coding"),
        startTier({ computeTier: "DEEP" }, "coding"),
      ];
      const decision = nextEscalation({ genome: {}, ...draft("rejected") });
      const held = tiers.join() === "STANDARD,DEEP" && decision.rung === null;
      return {
        held,
        detail: `start ${tiers.join("/")}, escalation ${decision.rung ?? "none"}`,
      };
    },
  },
  {
    level: 2,
    title: "a verified draft is never escalated",
    check() {
      const decision = nextEscalation({
        genome: { compute: { mode: "adaptive", minGainPerCall: 0 } },
        ...draft("verified", 20),
      });
      return { held: decision.rung === null, detail: decision.reason };
    },
  },
  {
    level: 3,
    title: "an uncertain draft gets the best gain per call that fits",
    check() {
      const genome = { compute: { mode: "adaptive" as const } };
      const rejected = nextEscalation({ genome, ...draft("rejected", 8) });
      const tight = nextEscalation({ genome, ...draft("rejected", 2) });
      const held =
        rejected.rung !== null &&
        tight.rung !== null &&
        tight.rung !== "team" &&
        startTier(genome, "coding") === "FAST";
      return {
        held,
        detail: `8 calls → ${rejected.rung}, 2 calls → ${tight.rung}, starts ${startTier(genome, "coding")}`,
      };
    },
  },
  {
    level: 4,
    title: "learned vetoes and empty budgets hold",
    check() {
      const vetoed = nextEscalation({
        genome: {
          compute: {
            mode: "adaptive",
            table: { general: { start: "STANDARD", escalate: false } },
          },
        },
        ...draft("rejected", 10),
      });
      const broke = nextEscalation({
        genome: { compute: { mode: "adaptive" } },
        ...draft("rejected", 1),
      });
      const learnedStart = startTier(
        {
          compute: {
            mode: "adaptive",
            table: { coding: { start: "DEEP", escalate: true } },
          },
        },
        "coding",
      );
      const held =
        vetoed.rung === null && broke.rung === null && learnedStart === "DEEP";
      return {
        held,
        detail: `veto ${vetoed.rung ?? "held"}, 1 call ${broke.rung ?? "none"}, learned start ${learnedStart}`,
      };
    },
  },
  {
    level: 5,
    title: "adaptive spends fewer calls per verified result than always-team",
    check() {
      const result = simulate(`pulse-${Math.floor(Date.now() / 3_600_000)}`);
      const { callsPerVerified, policies } = result;
      const held =
        callsPerVerified.adaptive < callsPerVerified.alwaysTeam &&
        policies.adaptive.verified >= policies.single.verified;
      return {
        held,
        detail: `calls per verified: single ${callsPerVerified.single.toFixed(2)}, always-team ${callsPerVerified.alwaysTeam.toFixed(2)}, adaptive ${callsPerVerified.adaptive.toFixed(2)} (simulated under the policy's priors)`,
      };
    },
  },
];
