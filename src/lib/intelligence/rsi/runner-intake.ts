import { z } from "zod";
import { genomeSchema, type StrategyGenome } from "../../strategy/runtime";
import { onAllowlist, trustRootArea } from "../software-rsi/policy";
import { RSI_MAX_CALLS_PER_ORDER } from "./budget";

// Orders the GitHub runners fetch from production. The host that answers
// is not trusted: until the public base URL is pinned, a captured workflow
// can be pointed at a server that returns whatever JSON it likes, and that
// JSON is what used to be executed with the UNOROUTER keys.
//
// Parsing happens before any model call and before any workspace command.
// Coding fixtures and `verify.kind: "tests"` are refused. Their files are
// attacker-controlled programs (`node --test` would run them), and a
// package.json script would run on the same machine as the keys.

const MAX_CODE_CALLS = 3;

const freeModelId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,78}:free$/);

const numericVerify = z.object({
  kind: z.literal("numeric"),
  value: z.number().finite(),
  tolerance: z.number().finite().nonnegative(),
});

const includesVerify = z.object({
  kind: z.literal("includes"),
  all: z.array(z.string().max(500)).min(1).max(20),
  none: z.array(z.string().max(500)).max(20).optional(),
});

const runnerSpec = z
  .object({
    kind: z.enum(["math", "research", "general"]),
    objective: z.string().min(1).max(8_000),
    verify: z.discriminatedUnion("kind", [numericVerify, includesVerify]),
    trap: z.string().max(80).optional(),
  })
  .strict();

const runnerTask = z
  .object({
    id: z.string().min(1).max(120),
    partition: z.enum(["dev", "holdout", "adversarial"]),
    spec: runnerSpec,
  })
  .strict();

const runnerBenchmark = z
  .object({
    id: z.string().min(1).max(120),
    family: z.string().min(1).max(80),
    spec: runnerSpec,
  })
  .strict();

const hypothesisText = z.object({
  statement: z.string().max(2_000),
});

function boundedGenome(
  value: unknown,
): { ok: true; genome: StrategyGenome } | { ok: false; reason: string } {
  const parsed = genomeSchema.safeParse(value ?? {});
  if (!parsed.success) return { ok: false, reason: "genome" };
  if (parsed.data.skills?.include?.length)
    return { ok: false, reason: "genome_skills" };
  if (parsed.data.tools?.include?.length)
    return { ok: false, reason: "genome_tools" };
  const roles = parsed.data.modelUse?.roles;
  if (
    roles &&
    Object.values(roles).some(
      (model) => typeof model !== "string" || !model.endsWith(":free"),
    )
  )
    return { ok: false, reason: "genome_model" };
  return { ok: true, genome: parsed.data };
}

const liveOrderBody = z
  .object({
    orderId: z.string().uuid(),
    strategyId: z.string().min(1).max(120),
    model: freeModelId,
    reserved: z.number().int().min(1).max(RSI_MAX_CALLS_PER_ORDER),
    hypothesis: hypothesisText,
    champion: z.object({ genome: z.unknown() }).passthrough(),
    challenger: z.object({ genome: z.unknown() }).passthrough(),
    tasks: z.array(runnerTask).max(6),
    benchmark: z.array(runnerBenchmark).max(4),
  })
  .passthrough();

export type RunnerLiveOrder = {
  orderId: string;
  strategyId: string;
  model: string;
  reserved: number;
  hypothesis: { statement: string };
  champion: { genome: StrategyGenome };
  challenger: { genome: StrategyGenome };
  tasks: z.infer<typeof runnerTask>[];
  benchmark: z.infer<typeof runnerBenchmark>[];
};

export type IntakeResult<T> =
  { ok: true; order: T } | { ok: false; reason: string };

/** The JSON body of GET /api/rsi/live, before a provider is constructed. */
export function parseLiveOrder(raw: unknown): IntakeResult<RunnerLiveOrder> {
  const envelope = z.object({ order: z.unknown() }).safeParse(raw);
  const body = liveOrderBody.safeParse(
    envelope.success ? envelope.data.order : raw,
  );
  if (!body.success) return { ok: false, reason: "shape" };
  if (!boundedSpecs(body.data)) return { ok: false, reason: "executable_spec" };
  const champion = boundedGenome(body.data.champion.genome);
  if (!champion.ok) return champion;
  const challenger = boundedGenome(body.data.challenger.genome);
  if (!challenger.ok) return challenger;
  return {
    ok: true,
    order: {
      orderId: body.data.orderId,
      strategyId: body.data.strategyId,
      model: body.data.model,
      reserved: body.data.reserved,
      hypothesis: { statement: body.data.hypothesis.statement },
      champion: { genome: champion.genome },
      challenger: { genome: challenger.genome },
      tasks: body.data.tasks,
      benchmark: body.data.benchmark,
    },
  };
}

/**
 * The schema already excludes coding tasks, fixtures and test commands.
 * This second look refuses a spec that still carries a command, a fixture
 * or a composition, which is how a fetched order used to start a shell.
 */
function boundedSpecs(order: z.infer<typeof liveOrderBody>) {
  const specs = [
    ...order.tasks.map((task) => task.spec),
    ...order.benchmark.map((task) => task.spec),
  ];
  return specs.every(
    (spec) =>
      !("command" in spec.verify) &&
      !("fixture" in spec) &&
      !("composition" in spec),
  );
}

const symbolName = z
  .string()
  .regex(/^[A-Za-z_$][\w$]{0,60}(?:\.[A-Za-z_$][\w$]{0,60})?$/);

const codeHypothesis = z
  .object({
    statement: z.string().min(1).max(2_000),
    expected: z.string().max(2_000),
    file: z.string().min(1).max(200),
    symbol: symbolName,
    arena: z.string().min(1).max(80),
    levels: z.array(z.number().int().min(1).max(20)).max(8),
    failing: z.array(z.string().max(200)).max(20),
    trustRoot: z.literal(false),
    rsiCycle: z.string().max(80).optional(),
  })
  .passthrough();

const codeOrderBody = z
  .object({
    id: z.string().min(8).max(80),
    calls: z.number().int().min(1).max(MAX_CODE_CALLS),
    model: freeModelId,
    hypothesis: codeHypothesis,
  })
  .passthrough();

export type RunnerCodeOrder = {
  id: string;
  calls: number;
  model: string;
  hypothesis: z.infer<typeof codeHypothesis>;
};

/** The JSON body of GET /api/rsi/software, before a model call or a diff. */
export function parseCodeOrder(raw: unknown): IntakeResult<RunnerCodeOrder> {
  const body = codeOrderBody.safeParse(raw);
  if (!body.success) return { ok: false, reason: "shape" };
  const file = body.data.hypothesis.file;
  if (
    body.data.hypothesis.trustRoot ||
    trustRootArea(file) ||
    !onAllowlist(file)
  )
    return { ok: false, reason: "file" };
  return {
    ok: true,
    order: {
      id: body.data.id,
      calls: body.data.calls,
      model: body.data.model,
      hypothesis: body.data.hypothesis,
    },
  };
}
