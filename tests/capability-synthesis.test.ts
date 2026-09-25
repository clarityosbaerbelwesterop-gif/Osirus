import { describe, expect, it } from "vitest";
import type { AgentDecision } from "../src/lib/agent/decision";
import { runAgentLoop } from "../src/lib/agent/loop";
import { MemoryIntelStore } from "../src/lib/intelligence/store/memory-store";
import {
  analyzeSource,
  isolationHolds,
  runIsolated,
} from "../src/lib/intelligence/synthesis/isolation";
import { generatedToolDefinition } from "../src/lib/intelligence/synthesis/generated-tools";
import {
  mineProcedures,
  synthesizeSkill,
} from "../src/lib/intelligence/synthesis/skills";
import {
  detectToolGaps,
  evolveTool,
  synthesizeTool,
  type ToolProposal,
} from "../src/lib/intelligence/synthesis/tools";
import { quarantine } from "../src/lib/intelligence/synthesis/quarantine";
import type { Experience } from "../src/lib/intelligence/types";
import { genomeSchema } from "../src/lib/strategy/runtime";
import { ToolRegistry, type ToolDefinition } from "../src/lib/tools/registry";

const IBAN_SOURCE = `function run(input) {
  const raw = String(input.iban);
  let s = "";
  for (let i = 0; i < raw.length; i += 1) {
    const c = raw[i];
    if (c !== " ") s += c.toUpperCase();
  }
  if (s.length < 15 || s.length > 34) return { valid: false };
  const moved = s.slice(4) + s.slice(0, 4);
  let rem = 0;
  for (let i = 0; i < moved.length; i += 1) {
    const code = moved.charCodeAt(i);
    let digits;
    if (code >= 48 && code <= 57) digits = String(code - 48);
    else if (code >= 65 && code <= 90) digits = String(code - 55);
    else return { valid: false };
    for (let j = 0; j < digits.length; j += 1)
      rem = (rem * 10 + (digits.charCodeAt(j) - 48)) % 97;
  }
  return { valid: rem === 1 };
}`;

const proposal = (source = IBAN_SOURCE): ToolProposal => ({
  name: "iban_validate",
  summary: "Check an IBAN's mod-97 checksum",
  inputSchema: {
    type: "object",
    properties: { iban: { type: "string", maxLength: 64 } },
    required: ["iban"],
  },
  source,
  tests: [
    { input: { iban: "DE89 3704 0044 0532 0130 00" }, expect: { valid: true } },
    { input: { iban: "GB82 WEST 1234 5698 7654 32" }, expect: { valid: true } },
    {
      input: { iban: "DE89 3704 0044 0532 0130 01" },
      expect: { valid: false },
    },
  ],
});

const HELD_OUT = [
  {
    input: { iban: "FR14 2004 1010 0505 0001 3M02 606" },
    expect: { valid: true },
  },
  { input: { iban: "NL91 ABNA 0417 1643 01" }, expect: { valid: false } },
];

let row = 0;
function experience(overrides: Partial<Experience>): Omit<Experience, "id"> {
  row += 1;
  return {
    source: "trial",
    taskRef: `task-${row}`,
    taskType: "reasoning",
    capabilityIds: ["reasoning.check"],
    difficulty: 3,
    strategyVersionId: null,
    model: null,
    skills: [],
    tools: [],
    trajectory: { actions: [] },
    verification: { verdicts: [] },
    outcome: "failure",
    failureClass: null,
    repairs: 0,
    costUsd: 0,
    tokens: 1000,
    latencyMs: 10,
    confidence: null,
    qualityScore: 0.5,
    fingerprint: `fp-${row}`,
    partition: "dev",
    provenance: {},
    createdAt: new Date().toISOString(),
    ...overrides,
  } as Omit<Experience, "id">;
}

describe("static analysis and isolation", () => {
  it("rejects every way out of the pure-function subset", () => {
    const bad = {
      process: "function run(input) { return process.env; }",
      require: "function run(input) { return require('fs'); }",
      fetch: "function run(input) { return fetch('https://x'); }",
      globalThis: "function run(input) { return globalThis; }",
      constructor: "function run(input) { return input.constructor; }",
      builtName: "function run(input) { return input['const' + 'ructor']; }",
      proto: "function run(input) { return input.__proto__; }",
      eval: "function run(input) { return eval('1'); }",
      Function: "function run(input) { return Function('return 1'); }",
      import: "function run(input) { return import('fs'); }",
      async: "async function run(input) { return 1; }",
      this: "function run(input) { return this; }",
      extra: "function run(input) { return 1; } run({});",
      class: "function run(input) { class A {} return 1; }",
    };
    for (const [name, source] of Object.entries(bad))
      expect(analyzeSource(source).ok, name).toBe(false);
    expect(analyzeSource(IBAN_SOURCE)).toMatchObject({ ok: true });
  });

  it("isolates execution: no host globals, no code generation, time and pollution bounded", async () => {
    expect(await isolationHolds()).toEqual({ ok: true, findings: [] });
    const loop = await runIsolated("function run(input) { while (true) {} }", [
      {},
    ]);
    expect(loop.results[0]).toEqual({
      ok: false,
      error: "ERR_SCRIPT_EXECUTION_TIMEOUT",
    });
    const pollute = await runIsolated(
      "function run(input) { Object.prototype.x = 1; return 1; }",
      [{}],
    );
    expect(pollute.results[0]).toMatchObject({
      ok: false,
      error: "prototype pollution detected",
    });
  }, 60_000);

  it("never registers a generated tool that could write or reach outside", () => {
    const registry = new ToolRegistry();
    const tool = generatedToolDefinition(
      {
        id: "gen.iban_validate@v1",
        name: "iban_validate",
        summary: "check",
        inputSchema: proposal().inputSchema as never,
        source: IBAN_SOURCE,
      },
      ["general"],
    )!;
    expect(tool.trust).toBe("generated");
    expect(() => registry.register({ ...tool, effect: "external" })).toThrow(
      /generated_tool_must_be_read_only/,
    );
    expect(() => registry.register({ ...tool, risk: "medium" })).toThrow();
    registry.register(tool);
    // An artifact edited after the pipeline is refused at load.
    expect(
      generatedToolDefinition(
        {
          id: "gen.x@v1",
          name: "x",
          summary: "x",
          inputSchema: {},
          source: "function run(input) { return process; }",
        },
        ["general"],
      ),
    ).toBeNull();
  });

  it("keeps the root of trust out of the genome", () => {
    for (const key of [
      "auth",
      "rls",
      "promotion",
      "evaluation",
      "audit",
      "budget",
    ])
      expect(() => genomeSchema.parse({ [key]: true }), key).toThrow();
    expect(() =>
      genomeSchema.parse({ tools: { include: ["compute.run"] } }),
    ).toThrow();
    expect(
      genomeSchema.parse({ tools: { include: ["gen.iban_validate@v1"] } }),
    ).toBeTruthy();
  });
});

describe("procedure mining and skill synthesis", () => {
  it("mines a procedure only across tasks and generators", () => {
    const steps = [
      { action: "USE_TOOL", toolId: "research.search", outcome: "ok" },
      { action: "USE_TOOL", toolId: "research.fetch", outcome: "ok" },
      { action: "VERIFY", outcome: "ok" },
      { action: "USE_TOOL", toolId: "compute.run", outcome: "ok" },
    ];
    const rows = [
      ...["a", "a", "b"].map((generator) =>
        experience({
          outcome: "verified_success",
          trajectory: { actions: steps },
          provenance: { generator },
        }),
      ),
    ].map((entry, index) => ({ ...entry, id: `e${index}` })) as Experience[];
    const mined = mineProcedures(rows);
    expect(mined[0]?.steps).toEqual([
      "research.search",
      "research.fetch",
      "VERIFY",
      "compute.run",
    ]);
    // One generator only: a benchmark template, not a skill.
    expect(
      mineProcedures(
        rows.map((entry) => ({ ...entry, provenance: { generator: "a" } })),
      ),
    ).toEqual([]);
    const skill = synthesizeSkill(mined[0]!, "research");
    expect(skill.id).toMatch(/^synth\.research\./);
    expect(skill.tools).toEqual([
      "research.search",
      "research.fetch",
      "compute.run",
    ]);
    expect(skill.instruction).toMatch(/Verify the intermediate result/);
    expect(skill.provenance).toMatchObject({
      tasks: 3,
      generators: ["a", "b"],
    });
  });
});

/** The unseen-task policy: use an offered tool whose summary fits, else guess. */
function checkPolicy(): (input: {
  system: string;
  user: string;
}) => Promise<AgentDecision> {
  return async ({ system, user }) => {
    const tool = /gen\.iban_validate@v\d+/.exec(system)?.[0];
    const iban = /IBAN ([A-Z0-9 ]+?) valid/.exec(user)?.[1];
    const result = /"valid":(true|false)/.exec(user)?.[1];
    if (tool && !result)
      return {
        action: "USE_TOOL",
        summary: "Check the checksum",
        toolId: tool,
        toolInput: { iban },
      };
    const valid = result ? result === "true" : true; // without a tool: guess
    return {
      action: "FINISH",
      summary: "Answer",
      answer: valid ? "valid" : "invalid",
    };
  };
}

async function solve(
  objective: string,
  truth: boolean,
  tools: ToolDefinition[],
) {
  const registry = new ToolRegistry();
  for (const tool of tools) registry.register(tool);
  const result = await runAgentLoop({
    objective,
    directives: [],
    context: [],
    tools: registry,
    toolContext: {
      runId: "r",
      stageId: "s",
      armId: "general",
      organizationId: "o",
      workspaceId: "w",
    },
    decide: checkPolicy(),
    bounds: {
      maxSteps: 6,
      maxModelCalls: 6,
      maxToolCalls: 3,
      maxWallMs: 20_000,
      maxConsecutiveFailures: 2,
    },
  });
  return (result.answer ?? "") === (truth ? "valid" : "invalid");
}

describe("novel capability: from repeated failure to a verified new tool", () => {
  it("detects the gap, synthesizes, gates, evaluates, promotes, and wins on an unseen task", async () => {
    const store = new MemoryIntelStore();
    // 1. Related tasks fail: the agent asks for a tool that does not exist.
    for (const generator of ["bank-forms", "payments", "kyc"])
      await store.insertExperience(
        experience({
          provenance: { generator },
          trajectory: {
            actions: [
              {
                action: "USE_TOOL",
                toolId: "iban.validate",
                outcome: "failed",
              },
              { action: "FINISH", outcome: "ok" },
            ],
          },
        }),
      );
    const history = await store.listExperience({ limit: 100 });
    // 2. The gap: the same missing operation across distinct tasks.
    const [gap] = detectToolGaps(history);
    expect(gap).toMatchObject({ operation: "iban.validate" });
    expect(gap!.tasks).toHaveLength(3);

    // 3. Synthesize through every gate; held-out capability evaluation is
    //    the production agent loop with and without the tool.
    const holdoutTasks = [
      { iban: "BE68 5390 0754 7034", valid: true },
      { iban: "BE68 5390 0754 7035", valid: false },
      { iban: "IT60 X054 2811 1010 0000 0123 456", valid: true },
      { iban: "IT60 X054 2811 1010 0000 0123 457", valid: false },
    ];
    const result = await synthesizeTool(store, {
      gap: gap!,
      propose: async () => proposal(),
      heldOutTests: HELD_OUT,
      cycleId: null,
      evaluate: async (candidate) => {
        const tool = generatedToolDefinition(
          { ...candidate.proposal, id: candidate.id },
          ["general"],
        )!;
        let withTool = 0;
        let without = 0;
        for (const task of holdoutTasks) {
          const objective = `Is the IBAN ${task.iban} valid?`;
          if (await solve(objective, task.valid, [tool])) withTool += 1;
          if (await solve(objective, task.valid, [])) without += 1;
        }
        return {
          with: { verified: withTool, n: holdoutTasks.length },
          without: { verified: without, n: holdoutTasks.length },
        };
      },
    });
    expect(result.stages.map((stage) => `${stage.stage}:${stage.ok}`)).toEqual([
      "propose:true",
      "static_analysis:true",
      "sandbox:true",
      "unit:true",
      "security:true",
      "adversarial:true",
      "holdout_eval:true",
      "candidate:true",
    ]);
    expect(result.id).toBe("gen.iban_validate@v1");
    // A candidate, not an installed tool.
    expect(result.artifact?.status).toBe("proposed");
    const [run] = await store.listGenerationRuns(5);
    expect(run?.kind).toBe("tool_synthesis");

    // 4. Promotion is the policy path: a genome that names the candidate.
    const genome = genomeSchema.parse({ tools: { include: [result.id!] } });
    await store.upsertArtifact({ ...result.artifact!, status: "active" });

    // 5. An unseen task, from a country no test or holdout used, selects it.
    const unseen = { iban: "ES91 2100 0418 4502 0005 1332", valid: true };
    const unseenInvalid = {
      iban: "ES91 2100 0418 4502 0005 1333",
      valid: false,
    };
    const tool = generatedToolDefinition(result.artifact!.content as never, [
      "general",
    ])!;
    const withTool = [
      await solve(
        `Is the IBAN ${unseen.iban} valid?`,
        unseen.valid,
        genome.tools?.include ? [tool] : [],
      ),
      await solve(
        `Is the IBAN ${unseenInvalid.iban} valid?`,
        unseenInvalid.valid,
        [tool],
      ),
    ];
    const without = [
      await solve(`Is the IBAN ${unseen.iban} valid?`, unseen.valid, []),
      await solve(
        `Is the IBAN ${unseenInvalid.iban} valid?`,
        unseenInvalid.valid,
        [],
      ),
    ];
    // 6. Paired verified performance goes up.
    expect(withTool.filter(Boolean).length).toBe(2);
    expect(without.filter(Boolean).length).toBe(1);
  }, 120_000);

  it("stops a candidate at the first gate it fails", async () => {
    const store = new MemoryIntelStore();
    const gap = {
      operation: "iban.validate",
      capabilityId: null,
      tasks: ["a", "b", "c"],
      evidence: [],
    };
    const evaluate = async () => ({
      with: { verified: 1, n: 1 },
      without: { verified: 0, n: 1 },
    });
    const hostile = await synthesizeTool(store, {
      gap,
      propose: async () =>
        proposal("function run(input) { return process.env; }"),
      heldOutTests: [],
      evaluate,
      cycleId: null,
    });
    expect(hostile.stages.at(-1)).toMatchObject({
      stage: "static_analysis",
      ok: false,
    });
    const wrong = await synthesizeTool(store, {
      gap,
      propose: async () =>
        proposal("function run(input) { return { valid: true }; }"),
      heldOutTests: HELD_OUT,
      evaluate,
      cycleId: null,
    });
    expect(wrong.stages.at(-1)).toMatchObject({ stage: "unit", ok: false });
    const useless = await synthesizeTool(store, {
      gap,
      propose: async () => proposal(),
      heldOutTests: HELD_OUT,
      evaluate: async () => ({
        with: { verified: 2, n: 4 },
        without: { verified: 2, n: 4 },
      }),
      cycleId: null,
    });
    expect(useless.stages.at(-1)).toMatchObject({
      stage: "holdout_eval",
      ok: false,
    });
    expect(await store.listArtifacts({ kind: "tool_candidate" })).toHaveLength(
      0,
    );
  }, 120_000);

  it("evolves v1 to v2 only when v2 beats v1, and quarantines on rollback", async () => {
    const store = new MemoryIntelStore();
    const gap = {
      operation: "iban.validate",
      capabilityId: "reasoning.check",
      tasks: ["a", "b", "c"],
      evidence: [],
    };
    const v1 = await synthesizeTool(store, {
      gap,
      propose: async () => proposal(),
      heldOutTests: [],
      evaluate: async () => ({
        with: { verified: 3, n: 4 },
        without: { verified: 1, n: 4 },
      }),
      cycleId: null,
    });
    expect(v1.ok).toBe(true);
    const v2 = await evolveTool(store, {
      v1: v1.artifact!,
      failures: ["lowercase input rejected"],
      propose: async ({ previous }) => {
        expect(previous?.failures).toEqual(["lowercase input rejected"]);
        return proposal();
      },
      heldOutTests: HELD_OUT,
      evaluate: async () => ({
        with: { verified: 4, n: 4 },
        without: { verified: 0, n: 4 },
      }),
      cycleId: null,
    });
    expect(v2.id).toBe("gen.iban_validate@v2");
    const artifacts = await store.listArtifacts({ kind: "tool_candidate" });
    expect(
      artifacts.find((a) => a.content.id === "gen.iban_validate@v1")?.status,
    ).toBe("superseded");

    const quarantined = await quarantine(store, {
      target: { kind: "tool", artifact: v2.artifact! },
      reason: "canary rollback: verified rate fell",
      evidence: { canary: "3/10 vs 7/10" },
      strategyVersionId: "v-canary",
      capabilityId: "reasoning.check",
    });
    expect(quarantined.label).toBe("gen.iban_validate@v2");
    const after = await store.listArtifacts({ kind: "tool_candidate" });
    expect(
      after.find((a) => a.content.id === "gen.iban_validate@v2")?.status,
    ).toBe("quarantined");
    const [event] = await store.listPromotions(5);
    expect(event).toMatchObject({ toStatus: "quarantined" });
    expect(
      (await store.listAgenda()).some((item) =>
        /Repair quarantined tool/.test(item.title),
      ),
    ).toBe(true);
  }, 120_000);
});
