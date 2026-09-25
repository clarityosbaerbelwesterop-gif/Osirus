import { createHash } from "node:crypto";
import { z } from "zod";
import { fingerprint } from "../evals/random";
import type { IntelStore } from "../store/store";
import type { Experience, LearningArtifact } from "../types";
import { analyzeSource, isolationHolds, runIsolated } from "./isolation";

// Tool synthesis (M43): from a gap that several tasks share to a candidate
// tool -- never to an installed one.
//
//   PROPOSE -> STATIC ANALYSIS -> SANDBOX -> UNIT -> SECURITY ->
//   ADVERSARIAL -> HOLDOUT EVAL -> CANDIDATE
//
// A candidate is a learning artifact (kind tool_candidate). It reaches a
// run only when a policy names it (genome.tools.include: a Foundry trial,
// then champion and canary like any strategy change), and then only as a
// read-only, low-risk tool with trust "generated" that runs in the
// isolated executor. Nothing here writes to the production tool registry.

export type ToolGap = {
  operation: string;
  capabilityId: string | null;
  tasks: string[];
  evidence: string[];
};

/**
 * A tool gap is real only when the same missing operation shows up across
 * distinct tasks: the agent asked for a tool that does not exist, or did by
 * hand, step after step, what one operation would do.
 */
export function detectToolGaps(
  experience: Experience[],
  options: { minTasks?: number; manualRun?: number } = {},
): ToolGap[] {
  const minTasks = options.minTasks ?? 3;
  const manualRun = options.manualRun ?? 4;
  const byOperation = new Map<string, ToolGap>();
  const note = (operation: string, row: Experience, evidence: string) => {
    const gap = byOperation.get(operation) ?? {
      operation,
      capabilityId: row.capabilityIds[0] ?? null,
      tasks: [],
      evidence: [],
    };
    const task = row.taskRef ?? row.fingerprint;
    if (!gap.tasks.includes(task)) gap.tasks.push(task);
    if (gap.evidence.length < 8) gap.evidence.push(evidence);
    byOperation.set(operation, gap);
  };
  for (const row of experience) {
    if (row.outcome === "error" || row.outcome === "verified_success") continue;
    const actions = row.trajectory.actions ?? [];
    for (const action of actions)
      if (
        action.action === "USE_TOOL" &&
        action.toolId &&
        /failed|denied|unknown/.test(action.outcome) &&
        /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/.test(action.toolId)
      )
        note(action.toolId, row, `${row.id}: asked for ${action.toolId}`);
    let streak = 0;
    let tool = "";
    for (const action of actions) {
      if (action.action === "USE_TOOL" && action.toolId === tool) streak += 1;
      else {
        tool = action.toolId ?? "";
        streak = action.action === "USE_TOOL" ? 1 : 0;
      }
      if (streak === manualRun)
        note(`manual:${tool}`, row, `${row.id}: ${manualRun}x ${tool} by hand`);
    }
  }
  return [...byOperation.values()]
    .filter((gap) => gap.tasks.length >= minTasks)
    .sort((a, b) => b.tasks.length - a.tasks.length);
}

const jsonSchemaSubset: z.ZodType<Record<string, unknown>> = z
  .object({
    type: z.literal("object"),
    properties: z.record(
      z.string().regex(/^[a-zA-Z]\w{0,30}$/),
      z.object({
        type: z.enum(["string", "number", "integer", "boolean", "array"]),
        maxLength: z.number().int().positive().max(100_000).optional(),
      }),
    ),
    required: z.array(z.string()).max(12).optional(),
  })
  .strict();

export const toolProposalSchema = z.object({
  name: z.string().regex(/^[a-z][a-z0-9_]{1,40}$/),
  summary: z.string().min(8).max(300),
  inputSchema: jsonSchemaSubset,
  source: z.string().min(10).max(6_000),
  tests: z
    .array(
      z.object({
        input: z.record(z.string(), z.unknown()),
        expect: z.unknown(),
      }),
    )
    .min(3)
    .max(20),
});
export type ToolProposal = z.infer<typeof toolProposalSchema>;

export type Proposer = (input: {
  gap: ToolGap;
  previous?: { source: string; failures: string[] };
}) => Promise<ToolProposal>;

/** Held-out capability evaluation: verified rate with and without the tool. */
export type HoldoutEvaluator = (candidate: {
  id: string;
  proposal: ToolProposal;
  call: (input: unknown) => Promise<unknown>;
}) => Promise<{
  with: { verified: number; n: number };
  without: { verified: number; n: number };
}>;

export type StageReport = { stage: string; ok: boolean; detail: string };

export type SynthesisResult = {
  ok: boolean;
  id: string | null;
  stages: StageReport[];
  artifact: LearningArtifact | null;
};

const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);

/** Inputs built to break a tool: wrong types, huge, deep, hostile keys. */
export function adversarialInputs(schema: Record<string, unknown>): unknown[] {
  const properties = Object.keys(
    (schema.properties as Record<string, unknown>) ?? {},
  );
  const first = properties[0] ?? "value";
  const deep: Record<string, unknown> = {};
  let cursor = deep;
  for (let depth = 0; depth < 200; depth += 1) {
    cursor.next = {};
    cursor = cursor.next as Record<string, unknown>;
  }
  return [
    {},
    { [first]: null },
    { [first]: "x".repeat(100_000) },
    { [first]: -1e308 },
    { [first]: [1, "two", null, { three: 3 }] },
    { [first]: deep },
    JSON.parse(`{"__proto__": {"polluted": true}, "${first}": "a"}`),
    { constructor: { prototype: { polluted: true } }, [first]: "a" },
  ];
}

export function toolId(name: string, version: number) {
  return `gen.${name}@v${version}`;
}

/**
 * Run the whole pipeline on one gap. Every stage must pass; the first that
 * fails stops it, and the report says which and why. A passing candidate
 * is stored as a tool_candidate artifact with status "proposed".
 */
export async function synthesizeTool(
  store: IntelStore,
  input: {
    gap: ToolGap;
    propose: Proposer;
    heldOutTests: Array<{ input: Record<string, unknown>; expect: unknown }>;
    evaluate: HoldoutEvaluator;
    cycleId: string | null;
    version?: number;
    previous?: { source: string; failures: string[] };
    minGain?: number;
  },
): Promise<SynthesisResult> {
  const stages: StageReport[] = [];
  const fail = (stage: string, detail: string): SynthesisResult => {
    stages.push({ stage, ok: false, detail });
    return { ok: false, id: null, stages, artifact: null };
  };
  const pass = (stage: string, detail: string) =>
    stages.push({ stage, ok: true, detail });

  // PROPOSE
  let proposal: ToolProposal;
  try {
    proposal = toolProposalSchema.parse(
      await input.propose({ gap: input.gap, previous: input.previous }),
    );
  } catch (error) {
    return fail("propose", (error as Error).message.slice(0, 200));
  }
  pass("propose", `${proposal.name}: ${proposal.summary}`);
  const id = toolId(proposal.name, input.version ?? 1);

  // STATIC ANALYSIS
  const analysis = analyzeSource(proposal.source);
  if (!analysis.ok)
    return fail("static_analysis", analysis.problems.join("; "));
  pass("static_analysis", `${analysis.nodes} nodes, allowlist only`);

  // SANDBOX: the candidate compiles and runs in the isolated executor.
  const smoke = await runIsolated(proposal.source, [proposal.tests[0]!.input]);
  if (smoke.fatal) return fail("sandbox", smoke.fatal);
  pass("sandbox", "compiled and ran in a fresh process without host access");

  // UNIT: the proposer's own tests, then held-out tests it never saw.
  const unit = [...proposal.tests, ...input.heldOutTests];
  const unitRun = await runIsolated(
    proposal.source,
    unit.map((test) => test.input),
  );
  if (unitRun.fatal) return fail("unit", unitRun.fatal);
  const failures = unit
    .map((test, index) => ({ test, result: unitRun.results[index] }))
    .filter(
      ({ test, result }) => !result?.ok || !same(result.output, test.expect),
    )
    .map(
      ({ test, result }) =>
        `${JSON.stringify(test.input).slice(0, 80)} -> ${result?.ok ? JSON.stringify(result.output).slice(0, 60) : result?.error} (want ${JSON.stringify(test.expect).slice(0, 60)})`,
    );
  if (failures.length)
    return fail(
      "unit",
      `${failures.length}/${unit.length} failed: ${failures.slice(0, 3).join("; ")}`,
    );
  pass(
    "unit",
    `${proposal.tests.length} proposed + ${input.heldOutTests.length} held-out passed`,
  );

  // SECURITY: the isolation holds on this host (probes that must fail),
  // and the context the candidate runs in exposes no host capability.
  const isolation = await isolationHolds();
  if (!isolation.ok)
    return fail(
      "security",
      `isolation broken: ${isolation.findings.join("; ")}`,
    );
  const view = await runIsolated(
    `${proposal.source.replace(/^\s*function\s+run\s*\(/, "function __candidate(")}\nfunction run(input) { return [typeof process, typeof require, typeof fetch, typeof globalThis.process, typeof __candidate]; }`,
    [{}],
  );
  if (
    view.fatal ||
    !view.results[0]?.ok ||
    !same(view.results[0].output, [
      "undefined",
      "undefined",
      "undefined",
      "undefined",
      "function",
    ])
  )
    return fail(
      "security",
      `candidate context exposes: ${JSON.stringify(view.results[0] ?? view.fatal)}`,
    );
  pass(
    "security",
    `${5} isolation probes blocked; candidate context has no process, require or fetch`,
  );

  // ADVERSARIAL: hostile inputs must fail cleanly or return JSON, within time.
  const hostile = adversarialInputs(proposal.inputSchema);
  const adversarial = await runIsolated(proposal.source, hostile, {
    callMs: 200,
    wallMs: 15_000,
  });
  if (adversarial.fatal) return fail("adversarial", adversarial.fatal);
  const polluted = adversarial.results.filter(
    (result) => !result.ok && /pollution/.test(result.error),
  );
  if (polluted.length)
    return fail("adversarial", "prototype pollution on hostile input");
  if (adversarial.results.length !== hostile.length)
    return fail("adversarial", "the executor lost calls on hostile input");
  pass(
    "adversarial",
    `${hostile.length} hostile inputs: ${adversarial.results.filter((result) => result.ok).length} returned, the rest failed cleanly`,
  );

  // HOLDOUT EVAL: paired, with the tool against without it.
  const call = async (value: unknown) => {
    const run = await runIsolated(proposal.source, [value]);
    const result = run.results[0];
    if (!result?.ok) throw new Error(result?.error ?? run.fatal ?? "failed");
    return result.output;
  };
  const holdout = await input.evaluate({ id, proposal, call });
  const rate = (side: { verified: number; n: number }) =>
    side.n ? side.verified / side.n : 0;
  const gain = rate(holdout.with) - rate(holdout.without);
  if (gain <= (input.minGain ?? 0))
    return fail(
      "holdout_eval",
      `with ${holdout.with.verified}/${holdout.with.n} vs without ${holdout.without.verified}/${holdout.without.n}: no gain`,
    );
  pass(
    "holdout_eval",
    `with ${holdout.with.verified}/${holdout.with.n} vs without ${holdout.without.verified}/${holdout.without.n}`,
  );

  // CANDIDATE: stored for evaluation and promotion, never installed.
  const sha = createHash("sha256").update(proposal.source).digest("hex");
  const artifact = await store.upsertArtifact({
    cycleId: input.cycleId,
    kind: "tool_candidate",
    capabilityId: input.gap.capabilityId,
    taskPattern: input.gap.operation,
    content: {
      id,
      name: proposal.name,
      version: input.version ?? 1,
      summary: proposal.summary,
      inputSchema: proposal.inputSchema,
      source: proposal.source,
      sha256: sha,
      effect: "read",
      risk: "low",
      trust: "generated",
    },
    evidence: { stages, gap: input.gap, holdout },
    support: input.gap.tasks.length,
    status: "proposed",
    fingerprint: fingerprint("tool_candidate", id, sha),
  });
  pass("candidate", `${id} stored as a candidate (not installed)`);
  await store.insertGenerationRun({
    cycleId: input.cycleId,
    kind: "tool_synthesis",
    config: { operation: input.gap.operation, id },
    produced: 1,
    verified: 1,
    rejected: 0,
    summary: {
      stages: stages.map(
        (stage) => `${stage.stage}:${stage.ok ? "ok" : "fail"}`,
      ),
    },
  });
  return { ok: true, id, stages, artifact };
}

/**
 * v1 -> v2: a candidate whose failures form a pattern gets a revised
 * proposal through the same pipeline; v2 is kept only if its held-out
 * result beats v1's.
 */
export async function evolveTool(
  store: IntelStore,
  input: {
    v1: LearningArtifact;
    failures: string[];
    propose: Proposer;
    heldOutTests: Array<{ input: Record<string, unknown>; expect: unknown }>;
    evaluate: HoldoutEvaluator;
    cycleId: string | null;
  },
) {
  const content = input.v1.content as { version?: number; source?: string };
  const gap = (input.v1.evidence as { gap?: ToolGap }).gap ?? {
    operation: input.v1.taskPattern ?? "unknown",
    capabilityId: input.v1.capabilityId,
    tasks: [],
    evidence: [],
  };
  const v1Holdout = (
    input.v1.evidence as {
      holdout?: { with: { verified: number; n: number } };
    }
  ).holdout?.with;
  const v1Rate = v1Holdout?.n ? v1Holdout.verified / v1Holdout.n : 0;
  const v2 = await synthesizeTool(store, {
    gap,
    propose: input.propose,
    heldOutTests: input.heldOutTests,
    cycleId: input.cycleId,
    version: (content.version ?? 1) + 1,
    previous: { source: content.source ?? "", failures: input.failures },
    evaluate: async (candidate) => {
      const result = await input.evaluate(candidate);
      // v2 has to beat v1, not only the no-tool baseline.
      return {
        with: result.with,
        without: {
          verified: Math.round(v1Rate * result.with.n),
          n: result.with.n,
        },
      };
    },
  });
  if (v2.ok && v2.artifact)
    await store.upsertArtifact({ ...input.v1, status: "superseded" });
  return v2;
}
