import { z } from "zod";
import {
  missionLedger,
  parkOnWait,
  recordActivity,
  resumeStage,
} from "../../arms/horizon-runtime";
import type { ArmStageContext, StageOutcome } from "../../arms/types";
import { MemoryMissionStore, updateMission } from "../../runtime/missions";
import { settlementFor } from "../../runtime/settlement";
import { ToolRegistry, type ToolDefinition } from "../../tools/registry";
import type { AgentDecision } from "../decision";
import {
  horizonOf,
  pruneExpired,
  type MissionWait,
  type ProbeResult,
  type WaitProbe,
} from "../long-horizon";
import { runAgentLoop, type LoopState } from "../loop";
import {
  addFacts,
  assessMissionGate,
  createMission,
  reconcileMission,
  seedForStage,
} from "../mission";

// LONG_HORIZON L1–L5 (M40): work that outlives a slice.
//
// Every stage slice here runs the production pieces a BaseArm stage runs:
// resumeStage (wake decision without a model, temporal re-validation),
// runAgentLoop (the WAIT action), parkOnWait, the mission-backed action
// ledger on a ToolRegistry, settlementFor (how a parked stage is stored) and
// the mission gate. A worker kill is a JSON round trip of the checkpoint and
// a fresh registry; "deploy between slices" hydrates an older checkpoint.
//
// Decisions come from a fixed fixture policy reading the prompt it was
// handed. The same policy runs with M40 ("horizon") and without it
// ("baseline": no typed waits, so it polls by thinking; no ledger; no
// re-validation). The difference measured is the mechanism, not a model.

export type HorizonMode = "horizon" | "baseline";

export type LongHorizonRecord = {
  id: string;
  level: 1 | 2 | 3 | 4 | 5;
  mode: HorizonMode;
  success: boolean;
  verifiedSuccess: boolean;
  falseCompletion: boolean;
  completedAs: "complete" | "partial" | "failed";
  modelCalls: number;
  toolCalls: number;
  /** Model calls spent while nothing could progress (waiting on the world). */
  modelCallsWhileWaiting: number;
  parkedSlices: number;
  duplicateExternalActions: number;
  staleFactsUsed: number;
  crashes: number;
  planRevisions: number;
  latencyMs: number;
  notes: string;
};

type Policy = (prompt: string, call: number) => AgentDecision;

const IDS = {
  organizationId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  workspaceId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  userId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
};

const BOUNDS = {
  maxSteps: 12,
  maxModelCalls: 16,
  maxToolCalls: 8,
  maxWallMs: 20_000,
  maxConsecutiveFailures: 3,
};

/** A scripted outside world: what probes see, slice by slice. */
class World {
  tick = 0;
  constructor(
    readonly readyAtTick: number,
    readonly detail: string,
  ) {}
  ready() {
    return this.tick >= this.readyAtTick;
  }
  probe(): WaitProbe {
    return async (): Promise<ProbeResult> =>
      this.ready()
        ? { state: "met", detail: this.detail }
        : { state: "unmet", detail: "not yet" };
  }
}

type Checkpoint = {
  loopState?: LoopState & { agentWait?: MissionWait };
};

class HorizonRun {
  readonly store = new MemoryMissionStore();
  readonly runId: string;
  checkpoint: Checkpoint = {};
  modelCalls = 0;
  toolCalls = 0;
  modelCallsWhileWaiting = 0;
  parkedSlices = 0;
  crashes = 0;
  refuseNext = false;
  notes: string[] = [];

  constructor(
    readonly mode: HorizonMode,
    readonly world: World | null,
    id: string,
  ) {
    this.runId = `00000000-0000-4000-8000-${id.padStart(12, "0")}`;
  }

  async init(objective: string, capabilities: string[]) {
    await this.store.create(
      this.runId,
      createMission({
        objective,
        nodes: capabilities.map((capability, index) => ({
          key: `s${index}-${capability}`,
          capability,
        })),
      }),
    );
  }

  context(stageKey: string): ArmStageContext {
    const [, segment, armId] = /^s(\d+)-(.+)$/.exec(stageKey)!;
    return {
      identity: { ...IDS, userId: IDS.userId },
      work: {
        runId: this.runId,
        stageId: this.runId,
        stageInput: { segment: Number(segment), armId },
      },
      runtime: {
        stores: {
          missions: () => this.store,
          ...(this.world ? { waitProbe: () => this.world!.probe() } : {}),
        },
      },
    } as unknown as ArmStageContext;
  }

  /** A worker dies after its last checkpoint: only durable state survives. */
  crash() {
    this.checkpoint = JSON.parse(JSON.stringify(this.checkpoint)) as Checkpoint;
    this.crashes += 1;
  }

  /**
   * One stage slice, as BaseArm runs it. Returns how the slice settled.
   */
  async slice(input: {
    stageKey: string;
    capability: string;
    objective: string;
    policy: Policy;
    tools: () => ToolRegistry;
    verify: (answer: string) => boolean;
  }): Promise<
    | { kind: "finished"; answer: string; verified: boolean }
    | { kind: "parked" | "yielded" | "blocked" | "failed" }
  > {
    if (this.world) this.world.tick += 1;
    const context = this.context(input.stageKey);
    const resumeState = this.checkpoint.loopState;
    const waitingBefore = Boolean(resumeState?.agentWait) || this.spinning;
    const callsBefore = this.modelCalls;

    let observations: string[] = [];
    if (this.mode === "horizon") {
      const resumed = await resumeStage(
        context,
        resumeState?.agentWait ?? null,
      );
      if (resumed.park) {
        this.parkedSlices += 1;
        // How the runtime stores it: not claimable until due, no attempt.
        const parked = settlementFor(resumed.park);
        if (
          parked.stageStatus !== "blocked" &&
          parked.stageStatus !== "waiting"
        )
          this.notes.push(`parked as ${parked.stageStatus}`);
        return { kind: "parked" };
      }
      if (resumeState?.agentWait) delete resumeState.agentWait;
      if (resumeState?.kernel && resumed.expired.length)
        resumeState.kernel = pruneExpired(resumeState.kernel, resumed.expired);
      observations = resumed.observations;
    }
    if (resumeState) resumeState.observations.push(...observations);

    const mission = (await this.store.load(this.runId))!.state;
    const seed = seedForStage(mission, input.capability);
    const tools = input.tools();
    if (this.mode === "horizon") tools.useLedger(await missionLedger(context));

    let call = resumeState?.modelCalls ?? 0;
    const toolsBefore = resumeState?.toolCalls ?? 0;
    const result = await runAgentLoop({
      objective: input.objective,
      directives: [],
      context: [...seed.context, ...(resumeState ? [] : observations)],
      tools,
      toolContext: {
        runId: this.runId,
        stageId: this.runId,
        armId: "general",
        organizationId: IDS.organizationId,
        workspaceId: IDS.workspaceId,
      },
      decide: async ({ user }) => {
        if (this.refuseNext) {
          this.refuseNext = false;
          throw Object.assign(new Error("rate limited"), {
            name: "ProviderError",
            code: "rate_limited",
            retryAfterMs: 1_000,
          });
        }
        this.modelCalls += 1;
        return input.policy(user, call++);
      },
      bounds: BOUNDS,
      resume: resumeState,
      task: { knownFacts: seed.task.knownFacts ?? [] },
      hooks: {
        verify: async (answer) => ({
          status: input.verify(answer) ? "verified" : "rejected",
          summary: "deterministic check",
          hypothesisIds: [],
        }),
      },
    });
    this.toolCalls += result.state.toolCalls - toolsBefore;
    if (waitingBefore && !this.world?.ready())
      this.modelCallsWhileWaiting += this.modelCalls - callsBefore;
    if (this.mode === "horizon")
      await recordActivity(context, result.state.kernel);

    if (result.status === "waiting" && result.pendingWait) {
      const parked = await parkOnWait(context, result.pendingWait);
      this.checkpoint.loopState = { ...result.state, agentWait: parked.wait };
      const stored = settlementFor(parked.outcome);
      if (stored.stageStatus === "blocked" && stored.retryDelaySeconds < 30)
        this.notes.push("poll wait re-claimed too early");
      this.parkedSlices += 1;
      return { kind: "parked" };
    }
    if (result.refusal) {
      this.checkpoint.loopState = result.state;
      this.notes.push(
        `provider refusal (${result.refusal.code}) kept the loop`,
      );
      return { kind: "blocked" };
    }
    if (result.status === "yielded") {
      this.checkpoint.loopState = result.state;
      return { kind: "yielded" };
    }
    delete this.checkpoint.loopState;
    if (result.status !== "finished") return { kind: "failed" };
    const answer = result.answer ?? "";
    const verified = input.verify(answer);
    await updateMission(this.store, this.runId, (state) =>
      reconcileMission(state, {
        stageKey: input.stageKey,
        capability: input.capability,
        kernel: result.state.kernel,
        verdict: verified ? "verified" : "rejected",
        handoff: {
          kind: "answer_summary",
          from: input.capability,
          verdict: verified ? "verified" : "rejected",
          summary: answer.slice(0, 600),
        },
      }),
    );
    return { kind: "finished", answer, verified };
  }

  /** Before M40 an agent waiting on the world yields and polls by thinking. */
  get spinning() {
    return (
      this.mode === "baseline" && Boolean(this.world && !this.world.ready())
    );
  }

  async gate(
    verdicts: Array<{ key: string; capability: string; verdict: string }>,
  ) {
    const mission = (await this.store.load(this.runId))!.state;
    return {
      status: assessMissionGate(mission, verdicts).status,
      planRevisions: mission.planRevisions.length,
      waits: horizonOf(mission).waits.length,
    };
  }
}

// ----- fixture tools ------------------------------------------------------

function readTool<T>(
  id: string,
  summary: string,
  value: () => T,
  counter?: { calls: number },
): ToolDefinition {
  return {
    id,
    title: id,
    summary,
    trust: "builtin",
    effect: "read",
    risk: "low",
    arms: ["general"],
    inputSchema: z.object({}).passthrough(),
    run: async () => {
      if (counter) counter.calls += 1;
      return value();
    },
  } as ToolDefinition;
}

function externalTool(id: string, effects: { count: number }): ToolDefinition {
  return {
    id,
    title: id,
    summary: "Publish a release (leaves Osirus; cannot be taken back)",
    trust: "builtin",
    effect: "external",
    risk: "medium",
    arms: ["general"],
    inputSchema: z.object({ version: z.string() }),
    run: async (input: unknown) => {
      effects.count += 1;
      return { published: (input as { version: string }).version };
    },
  } as ToolDefinition;
}

function flakyWrite(id: string, failures: { left: number }): ToolDefinition {
  return {
    id,
    title: id,
    summary: "Write the release notes",
    trust: "builtin",
    effect: "write",
    risk: "low",
    arms: ["general"],
    inputSchema: z.object({}).passthrough(),
    run: async () => {
      if (failures.left > 0) {
        failures.left -= 1;
        throw new Error("injected_fault: storage timeout");
      }
      return { written: true };
    },
  } as ToolDefinition;
}

/** An approval a person already gave; external calls need one. */
function registry(tools: ToolDefinition[]) {
  const registry = new ToolRegistry({ approvalGate: async () => "approved" });
  for (const tool of tools) registry.register(tool);
  return registry;
}

const callTool = (
  toolId: string,
  input: Record<string, unknown> = {},
): AgentDecision => ({
  action: "USE_TOOL",
  summary: `Call ${toolId}`,
  toolId,
  toolInput: input,
});
const verify = (answer: string): AgentDecision => ({
  action: "VERIFY",
  summary: "Check the result",
  answer,
});
const finish = (answer: string): AgentDecision => ({
  action: "FINISH",
  summary: "Report",
  answer,
});
const yieldNow: AgentDecision = {
  action: "YIELD",
  summary: "Continue in the next slice",
};

function lastNumber(prompt: string, pattern: RegExp): number | null {
  const all = [...prompt.matchAll(new RegExp(pattern.source, "g"))];
  const match = all.at(-1);
  return match ? Number(match[1]) : null;
}

/**
 * The fixture policy's rule for facts it was handed: only a line labelled
 * verified counts, and never one the prompt declares no longer valid.
 */
function trusted(prompt: string, pattern: RegExp) {
  return prompt
    .split("\n")
    .filter(
      (line) =>
        pattern.test(line) &&
        /\[verified/.test(line) &&
        !/No longer valid|Re-observe/.test(line),
    );
}

/**
 * The shared waiting policy. With typed waits the agent parks once; before
 * M40 it can only look again and yield, every slice.
 */
function waitOr(
  mode: HorizonMode,
  prompt: string,
  kind: "ci" | "deployment",
  statusTool: string,
): AgentDecision | null {
  const ended = new RegExp(`The ${kind} wait .* ended`).test(prompt);
  if (mode === "horizon")
    return ended
      ? null
      : {
          action: "WAIT",
          summary: `Wait for the ${kind} on main`,
          wait: { kind, reason: `${kind} on main`, ref: "main" },
        };
  // Baseline: poll by thinking. A status result that says "ready" ends it.
  const ready = new RegExp(`${statusTool}[\\s\\S]*"ready":true`).test(prompt);
  if (ready) return null;
  const polled = (
    prompt.match(new RegExp(`USE_TOOL ${statusTool} ->`, "g")) ?? []
  ).length;
  const yields = (prompt.match(/YIELD -> /g) ?? []).length;
  return polled > yields ? yieldNow : callTool(statusTool);
}

// ----- tasks ---------------------------------------------------------------

async function drive(
  run: HorizonRun,
  slice: Parameters<HorizonRun["slice"]>[0],
  hooks: {
    afterSlice?: (index: number, kind: string) => Promise<void> | void;
  } = {},
  maxSlices = 14,
) {
  for (let index = 0; index < maxSlices; index += 1) {
    const outcome = await run.slice(slice);
    await hooks.afterSlice?.(index, outcome.kind);
    if (outcome.kind === "finished") return outcome;
    if (outcome.kind === "failed") return null;
  }
  return null;
}

function record(
  base: Omit<
    LongHorizonRecord,
    | "latencyMs"
    | "notes"
    | "modelCalls"
    | "toolCalls"
    | "modelCallsWhileWaiting"
    | "parkedSlices"
    | "crashes"
  >,
  run: HorizonRun,
  startedAt: number,
): LongHorizonRecord {
  return {
    ...base,
    modelCalls: run.modelCalls,
    toolCalls: run.toolCalls,
    modelCallsWhileWaiting: run.modelCallsWhileWaiting,
    parkedSlices: run.parkedSlices,
    crashes: run.crashes,
    latencyMs: Date.now() - startedAt,
    notes: [
      "Offline fixture: the production loop, waits, ledger and re-validation with a scripted policy; it does not measure a model.",
      ...run.notes,
    ].join(" "),
  };
}

/** L1: a worker dies after a checkpoint; the stage resumes where it was. */
export async function horizonL1(mode: HorizonMode = "horizon") {
  const startedAt = Date.now();
  const run = new HorizonRun(mode, null, "401");
  const objective = "Report the account balance.";
  await run.init(objective, ["general"]);
  const balance = { calls: 0 };
  const done = await drive(
    run,
    {
      stageKey: "s0-general",
      capability: "general",
      objective,
      tools: () =>
        registry([
          readTool(
            "ledger.balance",
            "Account balance",
            () => ({ balance: 420 }),
            balance,
          ),
        ]),
      policy: (prompt) => {
        const value = lastNumber(prompt, /"balance":(\d+)/);
        if (value === null) return callTool("ledger.balance");
        if (!/Continue in the next slice/.test(prompt)) return yieldNow;
        return /VERIFY/.test(prompt) && /verified/.test(prompt)
          ? finish(`The balance is ${value} EUR.`)
          : verify(`The balance is ${value} EUR.`);
      },
      verify: (answer) => /\b420\b/.test(answer),
    },
    {
      afterSlice: (index, kind) =>
        index === 0 && kind === "yielded" ? run.crash() : undefined,
    },
  );
  const gate = await run.gate([
    {
      key: "s0-general",
      capability: "general",
      verdict: done?.verified ? "verified" : "rejected",
    },
  ]);
  const verified = Boolean(done?.verified) && balance.calls === 1;
  return record(
    {
      id: "m40-l1-crash-resume",
      level: 1,
      mode,
      success: Boolean(done),
      verifiedSuccess: verified && gate.status === "complete",
      falseCompletion: Boolean(done) && !done!.verified,
      completedAs: gate.status,
      duplicateExternalActions: 0,
      staleFactsUsed: 0,
      planRevisions: gate.planRevisions,
    },
    run,
    startedAt,
  );
}

/** L2: wait for a deployment without spending anything while waiting. */
export async function horizonL2(mode: HorizonMode = "horizon") {
  const startedAt = Date.now();
  const world = new World(4, "deployment main ready: success");
  const run = new HorizonRun(mode, world, "402");
  const objective = "When the deployment of main is ready, report its status.";
  await run.init(objective, ["general"]);
  const done = await drive(run, {
    stageKey: "s0-general",
    capability: "general",
    objective,
    tools: () =>
      registry([
        readTool("deploy.status", "Deployment status of a ref", () => ({
          ready: world.ready(),
          status: world.ready() ? "success" : "building",
        })),
      ]),
    policy: (prompt) => {
      const waiting = waitOr(mode, prompt, "deployment", "deploy.status");
      if (waiting) return waiting;
      const answer = "The deployment of main is ready: success.";
      return /Check the result/.test(prompt) ? finish(answer) : verify(answer);
    },
    verify: (answer) => /ready: success/.test(answer) && world.ready(),
  });
  const gate = await run.gate([
    {
      key: "s0-general",
      capability: "general",
      verdict: done?.verified ? "verified" : "rejected",
    },
  ]);
  return record(
    {
      id: "m40-l2-typed-wait",
      level: 2,
      mode,
      success: Boolean(done),
      verifiedSuccess: Boolean(done?.verified) && gate.status === "complete",
      falseCompletion: Boolean(done) && !done!.verified,
      completedAs: gate.status,
      duplicateExternalActions: 0,
      staleFactsUsed: 0,
      planRevisions: gate.planRevisions,
    },
    run,
    startedAt,
  );
}

/**
 * L3: an irreversible action, then the worker dies before its checkpoint and
 * an older checkpoint is hydrated (a deploy between slices); a write tool
 * fails once on the way.
 */
export async function horizonL3(mode: HorizonMode = "horizon") {
  const startedAt = Date.now();
  const run = new HorizonRun(mode, null, "403");
  const objective = "Publish release 2.1.0, then write its release notes.";
  await run.init(objective, ["general"]);
  const effects = { count: 0 };
  const failures = { left: 1 };
  const done = await drive(
    run,
    {
      stageKey: "s0-general",
      capability: "general",
      objective,
      tools: () =>
        registry([
          externalTool("release.publish", effects),
          flakyWrite("release.notes", failures),
        ]),
      policy: (_prompt, call) =>
        [
          callTool("release.publish", { version: "2.1.0" }),
          yieldNow,
          callTool("release.notes"),
          callTool("release.notes"),
          verify("Release 2.1.0 is published and its notes are written."),
          finish("Release 2.1.0 is published and its notes are written."),
        ][Math.min(call, 5)]!,
      verify: () => effects.count === 1 && failures.left === 0,
    },
    {
      afterSlice: (index) => {
        // The first slice's checkpoint never lands: the next worker starts
        // from the one before it.
        if (index === 0) {
          run.checkpoint = {};
          run.crashes += 1;
        }
      },
    },
  );
  const gate = await run.gate([
    {
      key: "s0-general",
      capability: "general",
      verdict: done?.verified ? "verified" : "rejected",
    },
  ]);
  return record(
    {
      id: "m40-l3-idempotent-action",
      level: 3,
      mode,
      success: Boolean(done),
      verifiedSuccess: Boolean(done?.verified) && gate.status === "complete",
      falseCompletion: Boolean(done) && !done!.verified,
      completedAs: gate.status,
      duplicateExternalActions: Math.max(0, effects.count - 1),
      staleFactsUsed: 0,
      planRevisions: gate.planRevisions,
    },
    run,
    startedAt,
  );
}

async function seedFact(
  run: HorizonRun,
  statement: string,
  capability = "general",
) {
  await updateMission(run.store, run.runId, (state) =>
    addFacts(state, [
      {
        statement,
        provenance: { capability, stageKey: "s0-" + capability, kind: "tool" },
        evidenceRefs: [`tool:${capability}:observation`],
        verified: true,
        volatility: "event",
      },
    ]),
  );
}

/** L4: an assumption goes stale while the agent waits. */
export async function horizonL4(mode: HorizonMode = "horizon") {
  const startedAt = Date.now();
  const world = new World(3, "deployment main ready: success");
  const run = new HorizonRun(mode, world, "404");
  const objective =
    "After the deployment of main is ready, report which API version production serves.";
  await run.init(objective, ["general"]);
  await seedFact(run, "Production serves API version 1");
  let staleUsed = 0;
  const done = await drive(run, {
    stageKey: "s0-general",
    capability: "general",
    objective,
    tools: () =>
      registry([
        readTool("deploy.status", "Deployment status of a ref", () => ({
          ready: world.ready(),
        })),
        readTool(
          "api.version",
          "The API version production serves now",
          () => ({
            version: world.ready() ? 2 : 1,
          }),
        ),
      ]),
    policy: (prompt) => {
      const waiting = waitOr(mode, prompt, "deployment", "deploy.status");
      if (waiting) return waiting;
      const known = trusted(prompt, /Production serves API version (\d+)/);
      const observed = lastNumber(prompt, /"version":(\d+)/);
      const version =
        observed ??
        (known.length ? lastNumber(known.join("\n"), /version (\d+)/) : null);
      if (version === null) return callTool("api.version");
      if (observed === null) staleUsed = 1;
      const answer = `Production serves API version ${version}.`;
      return /Check the result/.test(prompt) ? finish(answer) : verify(answer);
    },
    verify: (answer) => /version 2\b/.test(answer),
  });
  const gate = await run.gate([
    {
      key: "s0-general",
      capability: "general",
      verdict: done?.verified ? "verified" : "rejected",
    },
  ]);
  return record(
    {
      id: "m40-l4-stale-assumption",
      level: 4,
      mode,
      success: Boolean(done),
      verifiedSuccess: Boolean(done?.verified) && gate.status === "complete",
      falseCompletion: Boolean(done) && !done!.verified,
      completedAs: gate.status,
      duplicateExternalActions: 0,
      staleFactsUsed: staleUsed,
      planRevisions: gate.planRevisions,
    },
    run,
    startedAt,
  );
}

/**
 * L5: two capabilities across a crash, a CI wait, a provider refusal, a
 * price that changes while waiting, a replan and a verified finish, all
 * judged by the mission gate.
 */
export async function horizonL5(mode: HorizonMode = "horizon") {
  const startedAt = Date.now();
  const world = new World(4, "ci on main completed: success");
  const run = new HorizonRun(mode, world, "405");
  const objective =
    "Look up the unit price, wait for CI on main, then compute the cost of 4 units at the price valid after the release.";
  await run.init(objective, ["research", "math_science"]);
  const price = () => ({ unitPrice: world.ready() ? 15 : 12 });
  let staleUsed = 0;

  // Research: look up the price; the worker dies after its first checkpoint.
  const research = await drive(
    run,
    {
      stageKey: "s0-research",
      capability: "research",
      objective: "Look up the unit price.",
      tools: () =>
        registry([readTool("price.lookup", "Current unit price", price)]),
      policy: (prompt) => {
        const value = lastNumber(prompt, /"unitPrice":(\d+)/);
        if (value === null) return callTool("price.lookup");
        if (!/Continue in the next slice/.test(prompt)) return yieldNow;
        const answer = `The unit price is ${value} EUR.`;
        return /Check the result/.test(prompt)
          ? finish(answer)
          : verify(answer);
      },
      verify: (answer) => /unit price is 12 EUR/.test(answer),
    },
    {
      afterSlice: (index, kind) =>
        index === 0 && kind === "yielded" ? run.crash() : undefined,
    },
  );
  // What research established holds until the release: an event fact.
  await seedFact(run, "The unit price is 12 EUR", "research");

  // Compute: wait for CI, then compute with the price that is valid now.
  run.refuseNext = false;
  let slices = 0;
  const compute = await drive(
    run,
    {
      stageKey: "s1-math_science",
      capability: "math_science",
      objective:
        "Compute the cost of 4 units at the price valid after the release.",
      tools: () =>
        registry([
          readTool("ci.status", "CI status of a ref", () => ({
            ready: world.ready(),
          })),
          readTool("price.lookup", "Current unit price", price),
          readTool("calc.multiply", "Multiply", () => ({})),
        ]),
      policy: (prompt) => {
        const waiting = waitOr(mode, prompt, "ci", "ci.status");
        if (waiting) return waiting;
        const invalidated = /No longer valid:[^\n]*unit price/.test(prompt);
        const observed = lastNumber(prompt, /"unitPrice":(\d+)/);
        if (invalidated && observed === null) return callTool("price.lookup");
        if (invalidated && !/Replan/.test(prompt))
          return {
            action: "REPLAN",
            summary: "Replan: the price changed with the release",
          } as AgentDecision;
        const known = trusted(prompt, /unit price is (\d+) EUR/);
        const unit =
          observed ??
          (known.length
            ? lastNumber(known.join("\n"), /unit price is (\d+) EUR/)
            : null);
        if (unit === null) return callTool("price.lookup");
        if (observed === null) staleUsed = 1;
        const answer = `4 units cost ${unit * 4} EUR at ${unit} EUR each.`;
        return /Check the result/.test(prompt)
          ? finish(answer)
          : verify(answer);
      },
      verify: (answer) => /cost 60 EUR/.test(answer),
    },
    {
      afterSlice: () => {
        slices += 1;
        // The provider refuses once, right after the wait ends.
        if (slices === 1) run.refuseNext = mode === "horizon";
      },
    },
  );
  const verdicts = [
    {
      key: "s0-research",
      capability: "research",
      verdict: research?.verified ? "verified" : "rejected",
    },
    {
      key: "s1-math_science",
      capability: "math_science",
      verdict: compute?.verified ? "verified" : "rejected",
    },
  ];
  const gate = await run.gate(verdicts);
  return record(
    {
      id: "m40-l5-long-horizon",
      level: 5,
      mode,
      success: Boolean(compute),
      verifiedSuccess: gate.status === "complete",
      falseCompletion: Boolean(compute) && !compute!.verified,
      completedAs: gate.status,
      duplicateExternalActions: 0,
      staleFactsUsed: staleUsed,
      planRevisions: gate.planRevisions,
    },
    run,
    startedAt,
  );
}

export const LONG_HORIZON_TASKS = [
  { level: 1, difficulty: "LONG_HORIZON", run: horizonL1 },
  { level: 2, difficulty: "LONG_HORIZON", run: horizonL2 },
  { level: 3, difficulty: "ADVERSARIAL", run: horizonL3 },
  { level: 4, difficulty: "ADVERSARIAL", run: horizonL4 },
  { level: 5, difficulty: "FRONTIER", run: horizonL5 },
] as const;

/** The same five tasks, paired: M40 against the pre-M40 behaviour. */
export async function longHorizonComparison() {
  const rows: Array<{
    horizon: LongHorizonRecord;
    baseline: LongHorizonRecord;
  }> = [];
  for (const task of LONG_HORIZON_TASKS)
    rows.push({
      horizon: await task.run("horizon"),
      baseline: await task.run("baseline"),
    });
  return rows;
}

export type { StageOutcome };
