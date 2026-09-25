import { z } from "zod";
import type { StrategyGenome } from "../strategy/runtime";

// Collective intelligence (M41): a team is worth its calls only when it
// changes what is verified.
//
// A team is formed only for a stage whose draft is still uncertain, and
// only in the topology its policy names (champion or canary; the default
// is a single worker). Workers post structured claims to a shared
// blackboard, never their reasoning. Disagreement is settled by a
// discriminating test run through the stage's own tools -- a recomputation,
// a command in the sandbox, a source fetched again -- and never by counting
// votes. An adversary attacks the draft; only an attack its own check
// confirms becomes counter-evidence.

export const TEAM_TOPOLOGIES = [
  "single",
  "solver_critic",
  "parallel_solvers_judge",
  "solver_adversary",
] as const;
export type TeamTopology = (typeof TEAM_TOPOLOGIES)[number];

/** What a genome runs. The M26 `critic: true` is the solver_critic topology. */
export function topologyOf(genome: StrategyGenome | undefined): TeamTopology {
  const team = genome?.team;
  if (team?.topology) return team.topology;
  return team?.critic ? "solver_critic" : "single";
}

/** A check a worker offers for its claim, run through the stage's tools. */
export const teamCheckSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("compute"),
    /** Evaluated by compute.run; never by eval(). */
    expression: z.string().min(1).max(400),
  }),
  z.object({
    kind: z.literal("command"),
    cmd: z.string().min(1).max(200),
    args: z.array(z.string().max(2000)).max(32).default([]),
  }),
  z.object({
    kind: z.literal("source"),
    url: z.string().url().max(2000),
    quote: z.string().min(3).max(400),
  }),
]);
export type TeamCheck = z.infer<typeof teamCheckSchema>;

export const workerDraftSchema = z.object({
  answer: z.string().min(1).max(40_000),
  /** The load-bearing result, stated so drafts can be compared. */
  claim: z.string().min(1).max(300),
  check: teamCheckSchema.optional(),
});
export type WorkerDraft = z.infer<typeof workerDraftSchema> & { owner: string };

export const attackSchema = z.object({
  /** What the draft asserts, restated so a check can be judged against it. */
  claim: z.string().min(1).max(300),
  issues: z
    .array(
      z.object({
        kind: z.enum([
          "assumption",
          "coverage",
          "source",
          "security",
          "false_completion",
          "arithmetic",
        ]),
        statement: z.string().min(1).max(300),
        /** A check that would confirm the issue. Without one it stays open. */
        check: teamCheckSchema.optional(),
      }),
    )
    .max(6),
});
export type Attack = z.infer<typeof attackSchema>["issues"][number];

/** The result of running a check: what was observed, never an opinion. */
export type CheckResult = {
  ran: boolean;
  /** compute: the value; command: exit code; source: whether the quote is there. */
  observed: string;
  passed: boolean;
  evidenceRef: string;
};

export type CheckRunner = (check: TeamCheck) => Promise<CheckResult | null>;

export type BlackboardEntry = {
  id: string;
  claim: string;
  owner: string;
  status: "open" | "supported" | "disputed" | "refuted" | "confirmed";
  evidence: string[];
  counter: string[];
  /** Tests run on this claim, as observed. */
  tests: Array<{ check: string; observed: string; passed: boolean }>;
};

export type TeamOutcome = {
  topology: TeamTopology;
  answer: string;
  /** How the answer was chosen; "unresolved" keeps the primary draft. */
  resolution:
    | "single"
    | "consensus"
    | "discriminating_test"
    | "escalated_test"
    | "unresolved"
    | "adversary_confirmed"
    | "adversary_unconfirmed";
  blackboard: BlackboardEntry[];
  testsRun: number;
  disputes: number;
  /** What counting votes would have picked; recorded, never used. */
  majority: string | null;
  confirmedIssues: string[];
  openIssues: string[];
};

export function normalizeClaim(claim: string) {
  const number = /-?\d[\d,]*(?:\.\d+)?/.exec(claim.replace(/\s/g, ""));
  if (number) return String(Number(number[0].replaceAll(",", "")));
  return claim.toLowerCase().replace(/\s+/g, " ").trim();
}

function describe(check: TeamCheck) {
  switch (check.kind) {
    case "compute":
      return `compute ${check.expression}`;
    case "command":
      return `run ${[check.cmd, ...check.args].join(" ").slice(0, 160)}`;
    case "source":
      return `source ${check.url}`;
  }
}

/** Whether an observation supports a claim, or refutes it. */
export function judgeCheck(
  claim: string,
  check: TeamCheck,
  result: CheckResult,
): "supports" | "refutes" | "silent" {
  if (!result.ran) return "silent";
  if (check.kind === "compute") {
    const observed = Number(result.observed);
    const claimed = Number(normalizeClaim(claim));
    if (!Number.isFinite(observed) || !Number.isFinite(claimed))
      return "silent";
    return Math.abs(observed - claimed) <= 1e-9 * Math.max(1, Math.abs(claimed))
      ? "supports"
      : "refutes";
  }
  return result.passed ? "supports" : "refutes";
}

function majorityOf(drafts: WorkerDraft[]) {
  const counts = new Map<string, number>();
  for (const draft of drafts)
    counts.set(
      normalizeClaim(draft.claim),
      (counts.get(normalizeClaim(draft.claim)) ?? 0) + 1,
    );
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  return sorted.length && (sorted.length === 1 || sorted[0]![1] > sorted[1]![1])
    ? sorted[0]![0]
    : null;
}

/**
 * Settle a disagreement between drafts by running their checks. A claim
 * wins only if a check supports it and none refutes it, and it is the only
 * such claim. Otherwise one escalation: the judge is asked for a test that
 * tells the claims apart, and that test decides. Still undecided keeps the
 * first draft, marked disputed. Counting drafts decides nothing.
 */
export async function settleDisagreement(input: {
  drafts: WorkerDraft[];
  runCheck: CheckRunner;
  /** Ask for one discriminating test between the claims (the judge). */
  discriminate?: (claims: string[]) => Promise<TeamCheck | null>;
  maxTests?: number;
}): Promise<Omit<TeamOutcome, "topology" | "confirmedIssues" | "openIssues">> {
  const maxTests = input.maxTests ?? 4;
  const byClaim = new Map<
    string,
    BlackboardEntry & { drafts: WorkerDraft[] }
  >();
  input.drafts.forEach((draft, index) => {
    const key = normalizeClaim(draft.claim);
    const entry = byClaim.get(key) ?? {
      id: `c${byClaim.size + 1}`,
      claim: draft.claim,
      owner: draft.owner,
      status: "open" as const,
      evidence: [],
      counter: [],
      tests: [],
      drafts: [],
    };
    entry.drafts.push(draft);
    if (
      index > 0 &&
      entry.owner !== draft.owner &&
      !entry.owner.includes(draft.owner)
    )
      entry.owner = `${entry.owner}, ${draft.owner}`;
    byClaim.set(key, entry);
  });
  const entries = [...byClaim.values()];
  const majority = majorityOf(input.drafts);
  const strip = (): BlackboardEntry[] =>
    entries.map((entry) => ({
      id: entry.id,
      claim: entry.claim,
      owner: entry.owner,
      status: entry.status,
      evidence: entry.evidence,
      counter: entry.counter,
      tests: entry.tests,
    }));
  if (entries.length === 1) {
    entries[0]!.status = "supported";
    return {
      answer: input.drafts[0]!.answer,
      resolution: "consensus",
      blackboard: strip(),
      testsRun: 0,
      disputes: 0,
      majority,
    };
  }

  let testsRun = 0;
  // The same check offered twice runs once.
  const seen = new Map<string, CheckResult | null>();
  const run = async (check: TeamCheck) => {
    const key = describe(check);
    if (!seen.has(key)) {
      const result = await input.runCheck(check).catch(() => null);
      if (result) testsRun += 1;
      seen.set(key, result);
    }
    return seen.get(key) ?? null;
  };
  const apply = (
    entry: (typeof entries)[number],
    check: TeamCheck,
    result: CheckResult,
  ) => {
    const verdict = judgeCheck(entry.claim, check, result);
    entry.tests.push({
      check: describe(check),
      observed: result.observed,
      passed: verdict === "supports",
    });
    if (verdict === "supports") entry.evidence.push(result.evidenceRef);
    if (verdict === "refutes") entry.counter.push(result.evidenceRef);
  };
  for (const entry of entries) {
    for (const draft of entry.drafts) {
      if (!draft.check || testsRun >= maxTests) continue;
      const result = await run(draft.check);
      if (!result) continue;
      // A recomputation speaks to every claim; a command or a source speaks
      // only to the draft that offered it.
      if (draft.check.kind === "compute")
        for (const other of entries) apply(other, draft.check, result);
      else apply(entry, draft.check, result);
    }
  }
  const decide = () => {
    for (const entry of entries)
      entry.status = entry.counter.length
        ? "refuted"
        : entry.evidence.length
          ? "supported"
          : "disputed";
    const supported = entries.filter((entry) => entry.status === "supported");
    return supported.length === 1 ? supported[0]! : null;
  };
  let winner = decide();
  let resolution: TeamOutcome["resolution"] = winner
    ? "discriminating_test"
    : "unresolved";
  if (!winner && input.discriminate && testsRun < maxTests) {
    const test = await input
      .discriminate(entries.map((entry) => entry.claim))
      .catch(() => null);
    const result = test ? await run(test) : null;
    if (test && result) {
      for (const entry of entries)
        if (test.kind === "source") {
          // A source settles it by what it says: the claim it states wins.
          if (!result.ran || !result.passed) continue;
          const says = normalizeClaim(test.quote).includes(
            normalizeClaim(entry.claim),
          );
          entry.tests.push({
            check: describe(test),
            observed: result.observed,
            passed: says,
          });
          (says ? entry.evidence : entry.counter).push(result.evidenceRef);
        } else if (test.kind === "compute") apply(entry, test, result);
      winner = decide();
      if (winner) resolution = "escalated_test";
    }
  }
  if (winner) winner.status = "confirmed";
  return {
    answer: (winner ?? entries[0]!).drafts[0]!.answer,
    resolution,
    blackboard: strip(),
    testsRun,
    disputes: 1,
    majority,
  };
}

/**
 * Run the adversary's attacks. An issue whose check confirms it is
 * counter-evidence and must be fixed; an issue without a check, or whose
 * check does not confirm it, is recorded as an open question and changes
 * nothing.
 */
export async function weighAttacks(input: {
  issues: Attack[];
  runCheck: CheckRunner;
  /** What the draft claims, to tell a confirming observation from a refuting one. */
  claim: string;
  maxTests?: number;
}) {
  const confirmed: string[] = [];
  const open: string[] = [];
  let testsRun = 0;
  for (const issue of input.issues) {
    if (!issue.check || testsRun >= (input.maxTests ?? 3)) {
      open.push(issue.statement);
      continue;
    }
    const result = await input.runCheck(issue.check).catch(() => null);
    if (!result?.ran) {
      open.push(issue.statement);
      continue;
    }
    testsRun += 1;
    // The issue is confirmed when its check contradicts the draft.
    const verdict = judgeCheck(input.claim, issue.check, result);
    if (issue.check.kind === "compute" ? verdict === "refutes" : !result.passed)
      confirmed.push(`${issue.statement} (observed: ${result.observed})`);
    else open.push(`${issue.statement} (checked, not confirmed)`);
  }
  return { confirmed, open, testsRun };
}

/**
 * Value of delegation at run time: a team is formed only when the draft is
 * still uncertain. A draft a deterministic verifier already confirmed gains
 * nothing from more workers.
 */
export function teamWorthwhile(input: {
  topology: TeamTopology;
  verification: "unverified" | "partial" | "verified" | "rejected";
  openHypotheses: number;
  contradictions: number;
}) {
  if (input.topology === "single")
    return { form: false, reason: "single worker policy" };
  if (input.topology === "solver_critic")
    return { form: true, reason: "critic policy (M26 behaviour)" };
  if (input.verification === "verified")
    return {
      form: false,
      reason: "draft already verified; a team adds cost, not evidence",
    };
  if (
    input.verification === "rejected" ||
    input.contradictions > 0 ||
    input.openHypotheses > 0
  )
    return {
      form: true,
      reason:
        "draft uncertain: rejected check, contradiction or open hypothesis",
    };
  return { form: true, reason: "draft unverified" };
}

/** The calls a team makes; LLM-backed in production, scripted in the pulse. */
export type TeamMembers = {
  /** One more independent solver draft (the index is its seat). */
  solve: (seat: number) => Promise<WorkerDraft>;
  /** The primary draft's load-bearing claim and a check for it. */
  restate: (answer: string) => Promise<Pick<WorkerDraft, "claim" | "check">>;
  attack: (answer: string) => Promise<{ claim: string; issues: Attack[] }>;
  discriminate: (claims: string[]) => Promise<TeamCheck | null>;
  revise: (answer: string, issues: string[]) => Promise<string>;
  runCheck: CheckRunner;
};

/**
 * Run a topology over a stage's draft. `single` and `solver_critic` are
 * handled by the caller (the critic is the M26 path); this covers the M41
 * topologies. Any member that fails leaves the draft as it was.
 */
export async function formTeam(input: {
  topology: Exclude<TeamTopology, "single" | "solver_critic">;
  draft: string;
  solvers?: number;
  members: TeamMembers;
}): Promise<TeamOutcome> {
  const { members } = input;
  if (input.topology === "parallel_solvers_judge") {
    const seats = Math.min(3, Math.max(2, input.solvers ?? 2));
    const [primary, ...others] = await Promise.all([
      members.restate(input.draft).then((restated) => ({
        ...restated,
        answer: input.draft,
        owner: "solver-1",
      })),
      ...Array.from({ length: seats - 1 }, (_, index) =>
        members
          .solve(index + 2)
          .then((draft) => ({ ...draft, owner: `solver-${index + 2}` }))
          .catch(() => null),
      ),
    ]);
    const drafts = [primary, ...others].filter((draft): draft is WorkerDraft =>
      Boolean(draft),
    );
    const settled = await settleDisagreement({
      drafts,
      runCheck: members.runCheck,
      discriminate: members.discriminate,
    });
    return {
      topology: input.topology,
      ...settled,
      confirmedIssues: [],
      openIssues: [],
    };
  }
  const attack = await members.attack(input.draft);
  const weighed = await weighAttacks({
    issues: attack.issues,
    runCheck: members.runCheck,
    claim: attack.claim,
  });
  const answer = weighed.confirmed.length
    ? await members
        .revise(input.draft, weighed.confirmed)
        .catch(() => input.draft)
    : input.draft;
  return {
    topology: input.topology,
    answer,
    resolution: weighed.confirmed.length
      ? "adversary_confirmed"
      : "adversary_unconfirmed",
    blackboard: [
      {
        id: "c1",
        claim: attack.claim,
        owner: "solver-1",
        status: weighed.confirmed.length ? "refuted" : "open",
        evidence: [],
        counter: weighed.confirmed,
        tests: [],
      },
    ],
    testsRun: weighed.testsRun,
    disputes: weighed.confirmed.length ? 1 : 0,
    majority: null,
    confirmedIssues: weighed.confirmed,
    openIssues: weighed.open,
  };
}
