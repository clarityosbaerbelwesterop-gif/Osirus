import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { ComputeEngine } from "../../compute/engine";
import { computeTools } from "../../compute/tools";
import { ToolRegistry } from "../../tools/registry";
import type { AgentDecision } from "../decision";
import { runAgentLoop, type LoopHooks } from "../loop";
import {
  assessMissionGate,
  createMission,
  handoffLoss,
  reconcileMission,
  recordHandoff,
  recordSwitch,
  seedForStage,
  type MissionState,
} from "../mission";
import type { HypothesisSeed } from "../task-state";

// CROSS_DOMAIN L1–L5: one objective across capabilities, as one mission.
//
// Each capability step is the production agent loop with real tools
// (compute.run, node --test) and a deterministic verifier. Decisions come
// from a fixed fixture policy that uses what the step was handed: the
// mission seed (facts with provenance and verification, rejected
// hypotheses) or, in the pre-M39 mode, the previous steps' answer text. The
// same policy runs in both modes, so the difference measured is the handoff
// and the mission gate -- not a model. That limit is part of every result.

const exec = promisify(execFile);

export type CrossMode = "mission" | "prose";

export type CrossDomainRecord = {
  id: string;
  level: 1 | 2 | 3 | 4 | 5;
  mode: CrossMode;
  capabilities: string[];
  success: boolean;
  verifiedSuccess: boolean;
  /** The run declared the mission done while its evidence said otherwise. */
  falseCompletion: boolean;
  completedAs: "complete" | "partial" | "failed";
  handoffLoss: number;
  evidenceCoverage: number;
  switches: number;
  planRevisions: number;
  modelCalls: number;
  toolCalls: number;
  latencyMs: number;
  notes: string;
};

type StepView = { lines: string[]; rejected: string[] };

type StepResult = {
  answer: string;
  verdict: "verified" | "rejected" | "unverified";
  modelCalls: number;
  toolCalls: number;
};

const IDENTITY = {
  runId: "99999999-9999-4999-8999-999999999999",
  stageId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  organizationId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  workspaceId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
};

/**
 * The fixture policy for reading a value: a verified fact wins; a value a
 * rejected hypothesis names is avoided; otherwise the first mention.
 */
export function pickValue(view: StepView, pattern: RegExp): number | null {
  const verified = view.lines.find(
    (line) => /\[verified/.test(line) && pattern.test(line),
  );
  const source = verified ?? view.lines.find((line) => pattern.test(line));
  if (!source) return null;
  for (const match of source.matchAll(new RegExp(pattern.source, "gi"))) {
    const value = Number(match[1]);
    const dead = view.rejected.some((statement) =>
      statement.includes(String(match[1])),
    );
    if (!dead) return value;
  }
  return null;
}

class Mission {
  state: MissionState;
  answers: string[] = [];
  modelCalls = 0;
  toolCalls = 0;
  verdicts: Array<{ key: string; capability: string; verdict: string }> = [];

  constructor(
    readonly mode: CrossMode,
    objective: string,
    capabilities: string[],
  ) {
    this.state = createMission({
      objective,
      nodes: capabilities.map((capability, index) => ({
        key: `s${index}-${capability}`,
        capability,
      })),
    });
  }

  view(capability: string): StepView & { knownFacts: string[] } {
    if (this.mode === "prose")
      // Before M39: the next capability got the earlier answers as text.
      return { lines: this.answers, rejected: [], knownFacts: [] };
    const seed = seedForStage(this.state, capability);
    return {
      lines: seed.task.knownFacts ?? [],
      rejected: this.state.hypotheses
        .filter((h) => h.status === "REJECTED")
        .map((h) => h.statement),
      knownFacts: seed.task.knownFacts ?? [],
    };
  }

  async step(input: {
    capability: string;
    objective: string;
    decisions: (view: StepView) => AgentDecision[];
    verify: (answer: string) => {
      status: "verified" | "rejected";
      summary: string;
    };
    hypotheses?: HypothesisSeed[];
    hookVerify?: LoopHooks["verify"];
    spawnWorker?: LoopHooks["spawnWorker"];
    tools?: ToolRegistry;
  }): Promise<StepResult> {
    const index = this.verdicts.length;
    const key = `s${index}-${input.capability}`;
    const view = this.view(input.capability);
    const tools = input.tools ?? new ToolRegistry();
    const decisions = input.decisions(view);
    let cursor = 0;
    const result = await runAgentLoop({
      objective: input.objective,
      directives: [],
      context: this.mode === "prose" ? view.lines : [],
      tools,
      toolContext: { ...IDENTITY, armId: "general" },
      decide: async () => decisions[Math.min(cursor++, decisions.length - 1)]!,
      hypotheses: input.hypotheses,
      task: { knownFacts: view.knownFacts },
      bounds: {
        maxSteps: 8,
        maxModelCalls: 8,
        maxToolCalls: 4,
        maxWallMs: 20_000,
      },
      hooks: {
        verify:
          input.hookVerify ??
          (async (answer) => ({ ...input.verify(answer), hypothesisIds: [] })),
        ...(input.spawnWorker ? { spawnWorker: input.spawnWorker } : {}),
      },
    });
    const answer = result.answer ?? "";
    const verdict =
      result.status === "finished" ? input.verify(answer).status : "rejected";
    this.modelCalls += result.state.modelCalls;
    this.toolCalls += result.state.toolCalls;
    this.answers.push(answer);
    this.verdicts.push({ key, capability: input.capability, verdict });
    if (this.mode === "mission") {
      const offered = view.knownFacts.length;
      const received = view.knownFacts.filter((fact) =>
        (result.state.kernel?.knownFacts ?? []).includes(fact),
      ).length;
      // As verifyStage does in production: the verdict and the stage's
      // handoff land on the mission.
      this.state = recordHandoff(
        reconcileMission(this.state, {
          stageKey: key,
          capability: input.capability,
          kernel: result.state.kernel,
          verdict,
          handoff: {
            kind: "answer_summary",
            from: input.capability,
            verdict,
            summary: answer.slice(0, 1_200),
          },
        }),
        offered,
        received,
      );
    }
    return {
      answer,
      verdict,
      modelCalls: result.state.modelCalls,
      toolCalls: result.state.toolCalls,
    };
  }

  /** How the run ends: the mission gate, or (pre-M39) the last stage. */
  finish(): "complete" | "partial" | "failed" {
    if (this.mode === "prose")
      return this.verdicts.at(-1)?.verdict === "rejected"
        ? "failed"
        : "complete";
    return assessMissionGate(this.state, this.verdicts).status;
  }
}

function fact(statement: string, sources: string[]): AgentDecision[] {
  return [
    {
      action: "VERIFY",
      summary: "Check the source",
      answer: statement,
    },
    {
      action: "FINISH",
      summary: "Report the finding",
      answer: `${statement} Sources: ${sources.join(", ")}.`,
    },
  ];
}

function finish(answer: string): AgentDecision[] {
  return [
    { action: "VERIFY", summary: "Check the result", answer },
    { action: "FINISH", summary: "Report", answer },
  ];
}

function record(
  mission: Mission,
  input: {
    id: string;
    level: CrossDomainRecord["level"];
    correct: boolean;
    claimedDone: boolean;
    required: number;
    started: number;
    notes: string;
  },
): CrossDomainRecord {
  const completedAs = mission.finish();
  const complete = completedAs === "complete";
  const verifiedFacts = mission.state.facts.filter((f) => f.verified).length;
  return {
    id: input.id,
    level: input.level,
    mode: mission.mode,
    capabilities: mission.verdicts.map((entry) => entry.capability),
    success: complete && input.correct,
    verifiedSuccess:
      complete &&
      input.correct &&
      mission.verdicts.every((entry) => entry.verdict === "verified"),
    falseCompletion: complete && !input.correct && input.claimedDone,
    completedAs,
    handoffLoss: mission.mode === "mission" ? handoffLoss(mission.state) : 1,
    evidenceCoverage:
      mission.mode === "mission"
        ? Math.min(
            1,
            Number((verifiedFacts / Math.max(1, input.required)).toFixed(4)),
          )
        : 0,
    switches: mission.state.switches.length,
    planRevisions: mission.state.planRevisions.length,
    modelCalls: mission.modelCalls,
    toolCalls: mission.toolCalls,
    latencyMs: Date.now() - input.started,
    notes: input.notes,
  };
}

const RATE = /(\d{1,2})\s*%/;

/** L1: research → compute. Both modes should manage this. */
export async function crossL1(mode: CrossMode): Promise<CrossDomainRecord> {
  const started = Date.now();
  const mission = new Mission(mode, "Price 250 EUR plus VAT", [
    "research",
    "math_science",
  ]);
  await mission.step({
    capability: "research",
    objective: "What is the VAT rate?",
    decisions: () => fact("The VAT rate is 19%.", ["https://gov.example/vat"]),
    verify: (answer) =>
      /19%/.test(answer)
        ? { status: "verified", summary: "matches the official page" }
        : { status: "rejected", summary: "not the official rate" },
  });
  const math = await mission.step({
    capability: "math_science",
    objective: "Compute 250 EUR plus VAT",
    decisions: (view) => {
      const rate = pickValue(view, RATE) ?? 0;
      return finish(`Total: ${(250 * (1 + rate / 100)).toFixed(2)} EUR`);
    },
    verify: (answer) =>
      answer.includes("297.50")
        ? { status: "verified", summary: "recomputed 250 × 1.19" }
        : { status: "rejected", summary: "recomputation differs" },
  });
  return record(mission, {
    id: "cross-l1-vat",
    level: 1,
    correct: math.answer.includes("297.50"),
    claimedDone: true,
    required: 1,
    started,
    notes: "research → compute; the rate is stated once.",
  });
}

/** L2: a stale value sits next to the current one; research rejected it. */
export async function crossL2(mode: CrossMode): Promise<CrossDomainRecord> {
  const started = Date.now();
  const mission = new Mission(mode, "Price 250 EUR plus the current VAT", [
    "research",
    "math_science",
    "reasoning",
  ]);
  await mission.step({
    capability: "research",
    objective: "What is the current VAT rate?",
    hypotheses: [
      {
        id: "h-old",
        statement: "The VAT rate is 16%",
        falsifiers: ["the 16% rate expired"],
      },
    ],
    hookVerify: async () => ({
      status: "rejected",
      summary: "the 16% rate expired",
      hypothesisIds: ["h-old"],
      relation: "falsifies",
    }),
    decisions: () => [
      {
        action: "VERIFY",
        summary: "Check the older 16% figure",
        hypothesisIds: ["h-old"],
        answer: "16% expired",
      },
      {
        action: "FINISH",
        summary: "Report",
        answer:
          "An older page lists 16% (a temporary rate that expired); the current VAT rate is 19%. Sources: https://gov.example/vat.",
      },
    ],
    verify: (answer) =>
      /current VAT rate is 19%/.test(answer)
        ? { status: "verified", summary: "current official rate" }
        : { status: "rejected", summary: "not the current rate" },
  });
  // The loop's own record of the verified fact.
  if (mode === "mission")
    mission.state = reconcileMission(mission.state, {
      stageKey: "s0-research",
      capability: "research",
      handoff: {
        kind: "research_facts",
        from: "research",
        verdict: "verified",
        facts: [
          {
            statement: "The current VAT rate is 19%",
            status: "SUPPORTED",
            sources: ["https://gov.example/vat"],
          },
        ],
      },
    });
  const math = await mission.step({
    capability: "math_science",
    objective: "Compute 250 EUR plus the current VAT",
    decisions: (view) => {
      const rate = pickValue(view, RATE) ?? 0;
      return finish(
        `Total: ${(250 * (1 + rate / 100)).toFixed(2)} EUR at ${rate}% VAT`,
      );
    },
    verify: (answer) =>
      answer.includes("297.50")
        ? { status: "verified", summary: "recomputed with 19%" }
        : {
            status: "rejected",
            summary: "recomputation with the current rate differs",
          },
  });
  await mission.step({
    capability: "reasoning",
    objective: "Is the quoted total ready to send?",
    decisions: () => finish(`Yes. ${math.answer} -- ready to send.`),
    verify: (answer) =>
      answer.includes("297.50")
        ? { status: "verified", summary: "consistent with the recomputation" }
        : {
            status: "rejected",
            summary: "quotes a total the recomputation rejected",
          },
  });
  return record(mission, {
    id: "cross-l2-stale-rate",
    level: 2,
    correct: math.answer.includes("297.50"),
    claimedDone: true,
    required: 1,
    started,
    notes:
      "research rejects a stale rate; prose hands both numbers over, the mission hands the verified one and the rejected hypothesis.",
  });
}

/** L3: research + reasoning + compute, with the compute tool. */
export async function crossL3(mode: CrossMode): Promise<CrossDomainRecord> {
  const started = Date.now();
  const mission = new Mission(mode, "Monthly payment for a 12 000 EUR loan", [
    "research",
    "reasoning",
    "math_science",
  ]);
  await mission.step({
    capability: "research",
    objective: "What annual interest rate does the bank quote?",
    decisions: () =>
      fact("The bank quotes 6% per year, paid monthly over 12 months.", [
        "https://bank.example/rates",
      ]),
    verify: (answer) =>
      /6% per year/.test(answer)
        ? { status: "verified", summary: "matches the rate sheet" }
        : { status: "rejected", summary: "not on the rate sheet" },
  });
  await mission.step({
    capability: "reasoning",
    objective: "Which formula applies?",
    decisions: () =>
      finish(
        "An annuity: payment = P·r/(1-(1+r)^-n) with r = annual rate/12 and n = 12.",
      ),
    verify: (answer) =>
      /annuity/.test(answer)
        ? { status: "verified", summary: "the rate is paid monthly: annuity" }
        : { status: "rejected", summary: "wrong model" },
  });
  const tools = new ToolRegistry();
  for (const tool of computeTools(async () => ComputeEngine.inProcess()))
    tools.register(tool);
  const expected = (12000 * 0.005) / (1 - Math.pow(1.005, -12));
  const math = await mission.step({
    capability: "math_science",
    objective: "Compute the monthly payment",
    tools,
    decisions: (view) => {
      const rate = pickValue(view, /(\d{1,2})%\s*per year/) ?? 0;
      const r = rate / 100 / 12;
      return [
        {
          action: "USE_TOOL",
          summary: "Evaluate the annuity",
          toolId: "compute.run",
          toolInput: {
            op: "evaluate",
            expression: `12000 * ${r} / (1 - (1 + ${r})^(-12))`,
          },
        },
        ...finish(
          `Monthly payment: ${((12000 * r) / (1 - Math.pow(1 + r, -12))).toFixed(2)} EUR`,
        ),
      ];
    },
    verify: (answer) =>
      answer.includes(expected.toFixed(2))
        ? { status: "verified", summary: "independent recomputation agrees" }
        : { status: "rejected", summary: "recomputation differs" },
  });
  return record(mission, {
    id: "cross-l3-loan",
    level: 3,
    correct: math.answer.includes(expected.toFixed(2)),
    claimedDone: true,
    required: 2,
    started,
    notes:
      "research → reasoning → compute.run; the payment is recomputed independently.",
  });
}

async function nodeTest(files: Record<string, string>) {
  const root = await mkdtemp(join(tmpdir(), "osirus-cross-"));
  try {
    await mkdir(join(root, "test"), { recursive: true });
    await writeFile(join(root, "package.json"), '{"type":"module"}\n');
    for (const [path, content] of Object.entries(files))
      await writeFile(join(root, path), content);
    try {
      await exec(process.execPath, ["--test"], { cwd: root, timeout: 20_000 });
      return 0;
    } catch (error) {
      return (error as { code?: number }).code ?? 1;
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const PRICE_TEST = `import { test } from "node:test";
import assert from "node:assert/strict";
import { gross } from "../price.js";
test("gross at the current VAT", () => assert.equal(gross(250), 297.5));
test("gross of zero", () => assert.equal(gross(0), 0));
`;

/** L4: research + code + deterministic tests. */
export async function crossL4(mode: CrossMode): Promise<CrossDomainRecord> {
  const started = Date.now();
  const mission = new Mission(mode, "Ship gross() at the current VAT", [
    "research",
    "coding",
  ]);
  await mission.step({
    capability: "research",
    objective: "What is the current VAT rate?",
    hypotheses: [
      {
        id: "h-old",
        statement: "The VAT rate is 16%",
        falsifiers: ["expired"],
      },
    ],
    hookVerify: async () => ({
      status: "rejected",
      summary: "the 16% rate expired",
      hypothesisIds: ["h-old"],
      relation: "falsifies",
    }),
    decisions: () => [
      {
        action: "VERIFY",
        summary: "Check 16%",
        hypothesisIds: ["h-old"],
        answer: "expired",
      },
      {
        action: "FINISH",
        summary: "Report",
        answer:
          "The temporary 16% rate expired; the current VAT rate is 19%. Sources: https://gov.example/vat.",
      },
    ],
    verify: () => ({ status: "verified", summary: "current official rate" }),
  });
  if (mode === "mission")
    mission.state = reconcileMission(mission.state, {
      stageKey: "s0-research",
      capability: "research",
      handoff: {
        kind: "research_facts",
        from: "research",
        verdict: "verified",
        facts: [
          {
            statement: "The current VAT rate is 19%",
            status: "SUPPORTED",
            sources: ["https://gov.example/vat"],
          },
        ],
      },
    });
  let exitCode = 1;
  const coding = await mission.step({
    capability: "coding",
    objective: "Implement gross(net) at the current VAT and run the tests",
    decisions: (view) => {
      const rate = pickValue(view, RATE) ?? 0;
      return finish(`Implemented gross() with ${rate}% VAT. All tests pass.`);
    },
    verify: () => ({
      status: exitCode === 0 ? "verified" : "rejected",
      summary: `node --test exited ${exitCode}`,
    }),
    hookVerify: async (answer) => {
      const rate = Number(/with (\d+)% VAT/.exec(answer)?.[1] ?? 0);
      exitCode = await nodeTest({
        "price.js": `export const gross = (net) => Math.round(net * (1 + ${rate} / 100) * 100) / 100;\n`,
        "test/price.test.js": PRICE_TEST,
      });
      return {
        status: exitCode === 0 ? "verified" : "rejected",
        summary: `node --test exited ${exitCode}`,
      };
    },
  });
  // The verify hook ran the tests on the VERIFY draft; grade the final
  // answer's rate the same way.
  const rate = Number(/with (\d+)% VAT/.exec(coding.answer)?.[1] ?? 0);
  exitCode = await nodeTest({
    "price.js": `export const gross = (net) => Math.round(net * (1 + ${rate} / 100) * 100) / 100;\n`,
    "test/price.test.js": PRICE_TEST,
  });
  mission.verdicts[mission.verdicts.length - 1]!.verdict =
    exitCode === 0 ? "verified" : "rejected";
  if (mode === "mission")
    mission.state = reconcileMission(mission.state, {
      stageKey: "s1-coding",
      capability: "coding",
      verdict: exitCode === 0 ? "verified" : "rejected",
    });
  return record(mission, {
    id: "cross-l4-gross",
    level: 4,
    correct: exitCode === 0,
    claimedDone: /all tests pass/i.test(coding.answer),
    required: 1,
    started,
    notes:
      "research → coding; node --test decides. The coder claims the tests pass either way.",
  });
}

/**
 * L5: research → reason → compute → code → browser check → verification →
 * synthesis, with a capability the compute step finds missing.
 */
export async function crossL5(mode: CrossMode): Promise<CrossDomainRecord> {
  const started = Date.now();
  const mission = new Mission(
    mode,
    "Quote the yearly price with VAT and ship the price badge",
    [
      "research",
      "reasoning",
      "math_science",
      "coding",
      "building",
      "reasoning",
    ],
  );
  await mission.step({
    capability: "research",
    objective: "What does the plan cost per month?",
    decisions: () =>
      fact("The plan costs 25 EUR per month, net.", [
        "https://vendor.example/pricing",
      ]),
    verify: (answer) =>
      /25 EUR per month/.test(answer)
        ? { status: "verified", summary: "matches the price list" }
        : { status: "rejected", summary: "not on the price list" },
  });
  await mission.step({
    capability: "reasoning",
    objective: "What has to be computed?",
    decisions: () => finish("Yearly gross = monthly net × 12 × (1 + VAT)."),
    verify: () => ({
      status: "verified",
      summary: "consistent with the objective",
    }),
  });
  // The compute step finds the VAT rate missing and asks for research.
  let switched = false;
  const tools = new ToolRegistry();
  for (const tool of computeTools(async () => ComputeEngine.inProcess()))
    tools.register(tool);
  await mission.step({
    capability: "math_science",
    objective: "Compute the yearly gross price",
    tools,
    spawnWorker: async (task) => {
      switched = true;
      if (mode === "mission")
        mission.state = recordSwitch(
          mission.state,
          {
            from: { capability: "math_science", stageKey: "s2-math_science" },
            to: "research",
            reason: task.reason ?? "missing parameter",
            evidence: task.evidence ?? [],
            addedNodes: ["s6-research"],
          },
          [
            {
              key: "s6-research",
              capability: "research",
              objective: task.objective,
            },
          ],
        );
      return {
        summary: "research added",
        output: "A research step now runs next.",
      };
    },
    decisions: (view) =>
      pickValue(view, RATE) === null
        ? [
            {
              action: "SPAWN_WORKER",
              summary: "The VAT rate is an external parameter I do not have",
              workerTask: {
                objective: "Find the current VAT rate",
                capability: "research",
              },
            },
            ...finish("Waiting for the VAT rate from research."),
          ]
        : finish("Computed."),
    verify: () => ({ status: "verified", summary: "handed over for research" }),
  });
  await mission.step({
    capability: "research",
    objective: "What is the current VAT rate?",
    hypotheses: [
      {
        id: "h-old",
        statement: "The VAT rate is 16%",
        falsifiers: ["expired"],
      },
    ],
    hookVerify: async () => ({
      status: "rejected",
      summary: "expired",
      hypothesisIds: ["h-old"],
      relation: "falsifies",
    }),
    decisions: () => [
      {
        action: "VERIFY",
        summary: "Check 16%",
        hypothesisIds: ["h-old"],
        answer: "expired",
      },
      {
        action: "FINISH",
        summary: "Report",
        answer:
          "The temporary 16% rate expired; the current VAT rate is 19%. Sources: https://gov.example/vat.",
      },
    ],
    verify: () => ({ status: "verified", summary: "official" }),
  });
  if (mode === "mission")
    mission.state = reconcileMission(mission.state, {
      stageKey: "s3-research",
      capability: "research",
      handoff: {
        kind: "research_facts",
        from: "research",
        verdict: "verified",
        facts: [
          {
            statement: "The current VAT rate is 19%",
            status: "SUPPORTED",
            sources: ["https://gov.example/vat"],
          },
        ],
      },
    });
  const expected = (25 * 12 * 1.19).toFixed(2);
  const math = await mission.step({
    capability: "math_science",
    objective: "Compute the yearly gross price",
    tools,
    decisions: (view) => {
      const rate = pickValue(view, RATE) ?? 0;
      return [
        {
          action: "USE_TOOL",
          summary: "Evaluate",
          toolId: "compute.run",
          toolInput: {
            op: "evaluate",
            expression: `25 * 12 * (1 + ${rate} / 100)`,
          },
        },
        ...finish(
          `Yearly gross: ${(25 * 12 * (1 + rate / 100)).toFixed(2)} EUR (${rate}% VAT)`,
        ),
      ];
    },
    verify: (answer) =>
      answer.includes(expected)
        ? { status: "verified", summary: "recomputed" }
        : { status: "rejected", summary: "recomputation differs" },
  });
  const badgeValue = /Yearly gross: ([\d.]+)/.exec(math.answer)?.[1] ?? "0";
  let exitCode = 1;
  await mission.step({
    capability: "coding",
    objective: "Ship badge() showing the yearly gross price",
    decisions: () =>
      finish(`badge() renders "${badgeValue} EUR/year". All tests pass.`),
    verify: () => ({
      status: exitCode === 0 ? "verified" : "rejected",
      summary: `tests exited ${exitCode}`,
    }),
    hookVerify: async () => {
      exitCode = await nodeTest({
        "badge.js": `export const badge = () => "${badgeValue} EUR/year";\n`,
        "test/badge.test.js": `import { test } from "node:test";\nimport assert from "node:assert/strict";\nimport { badge } from "../badge.js";\ntest("badge", () => assert.equal(badge(), "${expected} EUR/year"));\n`,
      });
      return {
        status: exitCode === 0 ? "verified" : "rejected",
        summary: `tests exited ${exitCode}`,
      };
    },
  });
  // The browser check reads the rendered badge from the fixture page.
  const page = `<!doctype html><html><body><span id="badge">${badgeValue} EUR/year</span></body></html>`;
  await mission.step({
    capability: "building",
    objective: "Check the badge on the page",
    decisions: () => finish(`The page shows ${badgeValue} EUR/year.`),
    verify: () =>
      page.includes(`${expected} EUR/year`)
        ? { status: "verified", summary: "the DOM shows the recomputed price" }
        : { status: "rejected", summary: "the DOM shows a different price" },
  });
  const synthesis = await mission.step({
    capability: "reasoning",
    objective: "Summarise the mission",
    decisions: () =>
      finish(
        `Done: the yearly price is ${badgeValue} EUR and the badge is live.`,
      ),
    verify: () => ({
      status: "verified",
      summary: "summary restates the results",
    }),
  });
  return record(mission, {
    id: "cross-l5-price-badge",
    level: 5,
    correct: badgeValue === expected && exitCode === 0,
    claimedDone: /^Done/.test(synthesis.answer),
    required: 2,
    started,
    notes: `research → reason → compute (switch: ${switched ? "research added" : "none"}) → research → compute → code (node --test) → browser DOM check → synthesis.`,
  });
}

export const CROSS_DOMAIN_TASKS = [
  { level: 1, difficulty: "COMPOSED", run: crossL1 },
  { level: 2, difficulty: "ADVERSARIAL", run: crossL2 },
  { level: 3, difficulty: "COMPOSED", run: crossL3 },
  { level: 4, difficulty: "COMPOSED", run: crossL4 },
  { level: 5, difficulty: "FRONTIER", run: crossL5 },
] as const;

/** The same five tasks, paired: the mission against the pre-M39 handoff. */
export async function crossDomainComparison() {
  const rows: Array<{ mission: CrossDomainRecord; prose: CrossDomainRecord }> =
    [];
  for (const task of CROSS_DOMAIN_TASKS)
    rows.push({
      mission: await task.run("mission"),
      prose: await task.run("prose"),
    });
  return rows;
}
