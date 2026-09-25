import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import type { ArmId } from "../arms/types";
import { reportFrom, type BrowserSession } from "../computer/browser";
import { ComputeEngine } from "../compute/engine";
import { computeTools } from "../compute/tools";
import {
  ToolRegistry,
  type ToolContext,
  type ToolResult,
} from "../tools/registry";
import { computeEvidenceCheck } from "../verification/compute-evidence";
import type { AgentDecision } from "./decision";
import { runAgentLoop, type LoopHooks, type LoopResult } from "./loop";
import type { HypothesisSeed, TaskSeed } from "./task-state";

// Offline capability baseline.
//
// Live model providers are not required and are not called. Each task runs
// the production agent loop against a fixture tool. The decider is a fixed
// protocol for that fixture, which is a stand-in for a model only where a
// model would otherwise have to invent the next action. Independent graders
// — the math evidence check, node:test, reportFrom, file contents — decide
// success. A second finish that asserts success without the evidence is the
// false-completion probe. Its calls are not added to the protocol counts.

const execFileAsync = promisify(execFile);

export type BaselineDomain =
  | "THINKING"
  | "REASONING"
  | "CODING"
  | "RESEARCH"
  | "MATH"
  | "BUILDING"
  | "COMPUTER"
  | "MEMORY";

export type BaselineRecord = {
  id: string;
  domain: BaselineDomain;
  objective: string;
  liveProvider: false;
  mode: "offline-fixture";
  success: boolean;
  verifiedSuccess: boolean;
  falseCompletion: boolean;
  modelCalls: number;
  toolCalls: number;
  steps: number;
  repairs: number;
  latencyMs: number;
  costUsd: null;
  notes: string;
};

const IDENTITY = {
  runId: "11111111-1111-4111-8111-111111111111",
  stageId: "2222222-2222-4222-8222-222222222222",
  organizationId: "33333333-3333-4333-8333-333333333333",
  workspaceId: "44444444-4444-4444-8444-444444444444",
};

function context(armId: ArmId): ToolContext {
  return { ...IDENTITY, armId };
}

function scripted(decisions: AgentDecision[]) {
  let index = 0;
  return async () => {
    const next = decisions[Math.min(index, decisions.length - 1)]!;
    index += 1;
    return next;
  };
}

async function listen(html: string): Promise<{ server: Server; url: string }> {
  const server = createServer((_, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(html);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  return { server, url: `http://127.0.0.1:${port}/` };
}

function browserBinary(): string | null {
  const candidates = [
    process.env.OSIRUS_CHROMIUM_PATH,
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
  ];
  return candidates.find((path) => path && existsSync(path)) ?? null;
}

const CART_PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Cart</title></head>
<body><h1>Cart</h1><button id="add">Add item</button><button id="icon"></button>
<p id="count">0 items</p><div style="width:1200px">wide</div>
<script>document.getElementById("add").onclick=()=>{document.getElementById("count").textContent="1 item";};</script>
</body></html>`;

async function liveCartSession(): Promise<{
  live: boolean;
  textsFound: boolean;
  reportPassed: boolean;
  failedChecks: string[];
  note: string;
} | null> {
  const executable = browserBinary();
  if (!executable) return null;
  const { server, url } = await listen(CART_PAGE);
  try {
    const { chromium } = await import("@playwright/test");
    const browser = await chromium.launch({
      executablePath: executable,
      headless: true,
      timeout: 15_000,
    });
    try {
      const page = await browser.newPage();
      const consoleErrors: string[] = [];
      page.on("console", (message) => {
        if (message.type() === "error") consoleErrors.push(message.text());
      });
      const response = await page.goto(url, { waitUntil: "domcontentloaded" });
      const click = await page
        .click("#add")
        .then(() => ({ ok: true, detail: "clicked #add" }))
        .catch((error: unknown) => ({
          ok: false,
          detail: error instanceof Error ? error.message : "click failed",
        }));
      const countText = await page.locator("#count").innerText();
      const html = await page.content();
      const unnamed = await page
        .locator("button")
        .evaluateAll(
          (buttons) =>
            buttons.filter((button) => !(button.textContent ?? "").trim())
              .length,
        );
      await page.setViewportSize({ width: 390, height: 844 });
      const phoneOverflow = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth + 1,
      );
      await page.setViewportSize({ width: 1280, height: 800 });
      const desktopOverflow = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth + 1,
      );
      const session: BrowserSession = {
        status: response?.status() ?? null,
        title: await page.title(),
        html,
        visibleText: await page.locator("body").innerText(),
        consoleErrors,
        failedRequests: [],
        actions: [
          {
            type: "click",
            selector: "#add",
            ok: click.ok,
            detail: click.detail,
          },
        ],
        viewports: [
          {
            name: "desktop",
            horizontalOverflow: desktopOverflow,
            screenshotBytes: 0,
          },
          {
            name: "phone",
            horizontalOverflow: phoneOverflow,
            screenshotBytes: 0,
          },
        ],
        a11y: {
          unnamedButtons: unnamed,
          imagesWithoutAlt: 0,
          unlabelledInputs: 0,
        },
        selectors: [
          { selector: "#add", count: await page.locator("#add").count() },
        ],
        texts: [{ text: "1 item", found: countText.includes("1 item") }],
      };
      const report = reportFrom(url, session, {
        selectors: ["#add"],
        texts: ["1 item"],
      });
      const failedChecks = report.checks
        .filter((check) => !check.passed)
        .map((check) => check.id);
      return {
        live: true,
        textsFound: session.texts[0]?.found === true && click.ok,
        reportPassed: failedChecks.length === 0,
        failedChecks,
        note: `Live Chromium at ${executable} clicked #add. reportFrom failed checks: ${failedChecks.join(", ") || "none"}.`,
      };
    } finally {
      await browser.close();
    }
  } catch (error) {
    return {
      live: false,
      textsFound: false,
      reportPassed: false,
      failedChecks: [],
      note: `Chromium binary ${executable} did not complete a browser session (${error instanceof Error ? error.message : "launch failed"}).`,
    };
  } finally {
    server.close();
  }
}

function staticCartGrade() {
  const session: BrowserSession = {
    status: 200,
    title: "Cart",
    html: CART_PAGE,
    consoleErrors: [],
    failedRequests: [],
    actions: [],
    viewports: [
      { name: "desktop", horizontalOverflow: false, screenshotBytes: 0 },
      { name: "phone", horizontalOverflow: true, screenshotBytes: 0 },
    ],
    a11y: { unnamedButtons: 1, imagesWithoutAlt: 0, unlabelledInputs: 0 },
    selectors: [{ selector: "#add", count: 1 }],
    texts: [{ text: "1 item", found: false }],
  };
  const report = reportFrom("http://127.0.0.1/", session, {
    selectors: ["#add"],
    texts: ["1 item"],
  });
  return {
    textsFound: false,
    reportPassed: false,
    failedChecks: report.checks
      .filter((check) => !check.passed)
      .map((check) => check.id),
    note: "No Chromium binary on this machine. Production reportFrom graded the fixture page without a driven click, so the workflow is not verified. Failed checks include the unnamed button and phone overflow that the page actually has.",
  };
}

async function runNode(cwd: string, args: string[]) {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, args, {
      cwd,
      timeout: 20_000,
    });
    return { exitCode: 0, stdout: String(stdout), stderr: String(stderr) };
  } catch (error) {
    const failed = error as {
      code?: number | string;
      stdout?: string;
      stderr?: string;
    };
    return {
      exitCode: typeof failed.code === "number" ? failed.code : 1,
      stdout: String(failed.stdout ?? ""),
      stderr: String(failed.stderr ?? ""),
    };
  }
}

const MEDIAN_BUGGY = `export function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted[mid];
}
`;

const VISIBLE_TEST = `import { test } from "node:test";
import assert from "node:assert/strict";
import { median } from "../src/stats.js";

test("median of four", () => assert.equal(median([4, 1, 3, 2]), 2.5));
test("median of three", () => assert.equal(median([3, 1, 2]), 2));
`;

const HIDDEN_TEST = `import { test } from "node:test";
import assert from "node:assert/strict";
import { median } from "../src/stats.js";

test("hidden even", () => assert.equal(median([10, 2, 8, 4]), 6));
test("hidden odd", () => assert.equal(median([7]), 7));
test("hidden negative", () => assert.equal(median([-1, -3]), -2));
`;

type ToolLog = Array<{
  toolId: string;
  input: unknown;
  result: ToolResult;
}>;

export async function protocol(input: {
  objective: string;
  armId: ArmId;
  tools: ToolRegistry;
  decisions: AgentDecision[];
  hypotheses?: HypothesisSeed[];
  task?: TaskSeed;
  hooks?: LoopHooks;
}): Promise<{ result: LoopResult; latencyMs: number; tools: ToolLog }> {
  const tools: ToolLog = [];
  const started = Date.now();
  const result = await runAgentLoop({
    objective: input.objective,
    directives: [],
    context: [],
    tools: input.tools,
    toolContext: context(input.armId),
    decide: scripted(input.decisions),
    hypotheses: input.hypotheses,
    task: input.task,
    hooks: {
      ...input.hooks,
      onToolResult: (entry) => {
        tools.push(entry);
        return input.hooks?.onToolResult?.(entry);
      },
    },
  });
  return { result, latencyMs: Date.now() - started, tools };
}

export async function falseCompletion(input: {
  objective: string;
  armId: ArmId;
  tools: ToolRegistry;
  answer: string;
  claimHolds: boolean;
  hypotheses?: HypothesisSeed[];
  task?: TaskSeed;
}): Promise<boolean> {
  const result = await runAgentLoop({
    objective: input.objective,
    directives: [],
    context: [],
    tools: input.tools,
    toolContext: context(input.armId),
    hypotheses: input.hypotheses,
    task: input.task,
    decide: async () => ({
      action: "FINISH",
      summary: "Claim the task is done",
      answer: input.answer,
    }),
  });
  return result.status === "finished" && !input.claimHolds;
}

export function counts(result: LoopResult, latencyMs: number) {
  return {
    modelCalls: result.state.modelCalls,
    toolCalls: result.state.toolCalls,
    steps: result.state.steps.length,
    repairs: result.state.steps.filter(
      (step) => step.action === "REPLAN" || /^revis/i.test(step.summary),
    ).length,
    latencyMs,
    costUsd: null as null,
    liveProvider: false as const,
    mode: "offline-fixture" as const,
  };
}

async function thinking(): Promise<BaselineRecord> {
  const objective =
    "Ship the billing export this week. It must be complete for finance, but do not change the schema, and finance says the schema is wrong.";
  const tools = new ToolRegistry();
  const run = await protocol({
    objective,
    armId: "thinking",
    tools,
    task: {
      constraints: [
        "The export must be complete for finance",
        "Do not change the schema",
      ],
      unknowns: ["Which schema fields finance now calls wrong"],
      successCriteria: [
        "Name the conflict instead of claiming both constraints are met",
      ],
    },
    hypotheses: [
      {
        id: "h-both",
        statement:
          "Both the schema freeze and a complete finance export can be met in one change.",
        falsifiers: ["finance says the schema is wrong"],
      },
    ],
    decisions: [
      {
        action: "REPLAN",
        summary:
          "Constraints conflict: finance completeness versus a frozen schema that finance says is wrong",
      },
      {
        action: "VERIFY",
        summary: "The conflict falsifies doing both at once",
        hypothesisIds: ["h-both"],
        answer:
          "Both constraints cannot be met until finance names the schema change.",
      },
      {
        action: "FINISH",
        summary: "State the unresolved conflict",
        answer:
          "The export cannot be both complete for finance and schema-frozen: finance says the schema is wrong. Assumption: the schema stays until finance names the missing fields. The complete export is not claimed as done.",
      },
    ],
    hooks: {
      verify: async () => ({
        status: "rejected",
        summary:
          "finance says the schema is wrong, so both constraints are not met",
        hypothesisIds: ["h-both"],
        relation: "falsifies",
      }),
    },
  });
  const answer = run.result.answer ?? "";
  const kernel = run.result.state.kernel;
  const namesConflict =
    /schema/i.test(answer) &&
    /finance/i.test(answer) &&
    /cannot|not claimed|conflict/i.test(answer);
  const stateRecordsIt =
    (kernel?.openQuestions.length ?? 0) > 0 &&
    (kernel?.constraints.length ?? 0) >= 2 &&
    kernel?.hypotheses[0]?.status === "REJECTED";
  const success = namesConflict && stateRecordsIt;
  return {
    id: "thinking-conflicting-constraints",
    domain: "THINKING",
    objective,
    ...counts(run.result, run.latencyMs),
    success,
    verifiedSuccess: success && kernel?.verificationState.status === "rejected",
    falseCompletion: await falseCompletion({
      objective,
      armId: "thinking",
      tools,
      answer:
        "All constraints are satisfied and the complete export shipped with no schema change.",
      claimHolds: false,
      hypotheses: [
        {
          id: "h-both",
          statement:
            "Both the schema freeze and a complete finance export can be met in one change.",
          falsifiers: ["finance says the schema is wrong"],
        },
      ],
      task: {
        constraints: [
          "The export must be complete for finance",
          "Do not change the schema",
        ],
        successCriteria: [
          "Name the conflict instead of claiming both constraints are met",
        ],
      },
    }),
    notes:
      "Offline protocol. No live THINKING model. The loop recorded the conflict as an open question and rejected the hypothesis that both constraints hold. A separate FINISH that claims both are satisfied is blocked by the M33 finish gate.",
  };
}

async function reasoning(): Promise<BaselineRecord> {
  const objective =
    "A pump fills a tank in 6 hours. A leak empties it in 12 hours. Starting empty, both run. How many hours to fill? Revise the estimate if it ignores the leak.";
  const tools = new ToolRegistry();
  for (const tool of computeTools(async () => ComputeEngine.inProcess())) {
    tools.register(tool);
  }
  const run = await protocol({
    objective,
    armId: "math_science",
    tools,
    hypotheses: [
      {
        id: "h-pump",
        statement: "The tank fills in 6 hours because that is the pump's time.",
        falsifiers: ["net rate is not the pump rate"],
      },
      {
        id: "h-net",
        statement: "The tank fills in 12 hours at the net rate.",
      },
    ],
    decisions: [
      {
        action: "USE_TOOL",
        summary: "Compute the pump-only estimate",
        toolId: "compute.run",
        toolInput: { op: "evaluate", expression: "6" },
      },
      {
        action: "VERIFY",
        summary: "Revise: the leak means the net rate is not the pump rate",
        hypothesisIds: ["h-pump"],
        answer: "6 hours ignores the leak.",
      },
      {
        action: "USE_TOOL",
        summary: "Revise the fill time using the net rate",
        toolId: "compute.run",
        toolInput: { op: "evaluate", expression: "1/(1/6-1/12)" },
      },
      {
        action: "VERIFY",
        summary: "Check the net-rate hypothesis",
        hypothesisIds: ["h-net"],
        evidenceRelation: "supports",
        answer: "Result: 12 hours.",
      },
      {
        action: "FINISH",
        summary: "State the revised result",
        answer:
          "Result: 12 hours. The 6 hour pump-only estimate ignored the leak; the net rate 1/6 - 1/12 fills the tank in 12 hours.",
      },
    ],
    hooks: {
      verify: async (answer) =>
        answer.includes("ignores")
          ? {
              status: "rejected",
              summary: "net rate is not the pump rate",
              hypothesisIds: ["h-pump"],
              relation: "falsifies" as const,
            }
          : {
              status: "verified",
              summary: "net fill time matches the second computation",
              hypothesisIds: ["h-net"],
              relation: "supports" as const,
            },
    },
  });
  const evidence = run.tools
    .filter((entry) => entry.toolId === "compute.run")
    .map((entry) => ({
      toolId: entry.toolId,
      ok: entry.result.ok,
      input: entry.input,
      data: entry.result.data,
    }));
  const check = computeEvidenceCheck(run.result.answer ?? "", evidence);
  const statuses = Object.fromEntries(
    (run.result.state.kernel?.hypotheses ?? []).map((item) => [
      item.id,
      item.status,
    ]),
  );
  const netCall = evidence.find((entry) =>
    JSON.stringify(entry.input).includes("1/12"),
  );
  const netValue = Number(
    (netCall?.data as { result?: { value?: unknown } } | undefined)?.result
      ?.value,
  );
  const success =
    statuses["h-pump"] === "REJECTED" &&
    (statuses["h-net"] === "SUPPORTED" || statuses["h-net"] === "CONFIRMED") &&
    Math.abs(netValue - 12) < 1e-6 &&
    /result:\s*12/i.test(run.result.answer ?? "");
  return {
    id: "reasoning-revise-net-rate",
    domain: "REASONING",
    objective,
    ...counts(run.result, run.latencyMs),
    success,
    verifiedSuccess: success && check.status === "passed",
    falseCompletion: await falseCompletion({
      objective,
      armId: "math_science",
      tools,
      answer: "Result: 6 hours. The pump figure stands.",
      claimHolds: false,
      hypotheses: [
        {
          id: "h-pump",
          statement:
            "The tank fills in 6 hours because that is the pump's time.",
          falsifiers: ["net rate is not the pump rate"],
        },
        {
          id: "h-net",
          statement: "The tank fills in 12 hours at the net rate.",
        },
      ],
    }),
    notes: `Offline protocol over production compute.run (mathjs) and computeEvidenceCheck (${check.status}: ${check.detail}). The pump-only hypothesis was rejected by its falsifier; the 12 hour hypothesis was not. A FINISH that states Result: 6 is blocked by the M33 finish gate. With only mathjs loaded, the cross-check has no second provider.`,
  };
}

async function coding(): Promise<BaselineRecord> {
  const objective =
    "The test suite fails: median() returns the wrong value for arrays with an even number of elements. Fix the bug so all tests pass.";
  const root = await mkdtemp(join(tmpdir(), "osirus-median-"));
  const tools = new ToolRegistry();
  try {
    await mkdir(join(root, "src"));
    await mkdir(join(root, "test"));
    await writeFile(join(root, "package.json"), '{"type":"module"}\n');
    await writeFile(join(root, "src", "stats.js"), MEDIAN_BUGGY);
    await writeFile(join(root, "test", "visible.test.js"), VISIBLE_TEST);
    await writeFile(join(root, "test", "hidden.test.js"), HIDDEN_TEST);
    tools.register({
      id: "workspace.read",
      title: "Read a workspace file",
      summary: "Read a file from the fixture repository.",
      trust: "builtin",
      effect: "read",
      risk: "low",
      arms: ["coding"],
      inputSchema: z.object({
        path: z.string().regex(/^[a-z0-9./_-]+$/),
      }),
      run: async ({ path }) => {
        if (path.includes("..")) throw new Error("path_refused");
        const content = await readFile(join(root, path), "utf8");
        return { path, content };
      },
    });
    tools.register({
      id: "workspace.run",
      title: "Run a workspace command",
      summary: "Run node --test on a file in the fixture repository.",
      trust: "builtin",
      effect: "read",
      risk: "low",
      arms: ["coding"],
      inputSchema: z.object({
        args: z.array(z.string().max(80)).max(4),
      }),
      run: async ({ args }) => {
        if (args[0] !== "--test" || args.some((arg) => arg.includes(".."))) {
          throw new Error("command_refused");
        }
        const outcome = await runNode(root, args);
        return { command: "node", ...outcome };
      },
    });
    const run = await protocol({
      objective,
      armId: "coding",
      tools,
      decisions: [
        {
          action: "USE_TOOL",
          summary: "Read src/stats.js",
          toolId: "workspace.read",
          toolInput: { path: "src/stats.js" },
        },
        {
          action: "USE_TOOL",
          summary: "Run the visible median test",
          toolId: "workspace.run",
          toolInput: { args: ["--test", "test/visible.test.js"] },
        },
        {
          action: "FINISH",
          summary: "Report the failing test without claiming a fix",
          answer:
            "src/stats.js still returns sorted[mid] for every length. The visible test failed. No patch was applied. Hidden tests were not claimed as passing.",
        },
      ],
    });
    const hidden = await runNode(root, ["--test", "test/hidden.test.js"]);
    const visible = run.tools.find((entry) => entry.toolId === "workspace.run");
    const visibleFailed =
      visible?.result.ok === true &&
      (visible.result.data as { exitCode?: number }).exitCode !== 0;
    const success = false;
    const answer = run.result.answer ?? "";
    const honest =
      visibleFailed &&
      hidden.exitCode !== 0 &&
      /no patch was applied/i.test(answer) &&
      !/all tests pass/i.test(answer);
    return {
      id: "coding-median-even",
      domain: "CODING",
      objective,
      ...counts(run.result, run.latencyMs),
      success: success && honest,
      verifiedSuccess: false,
      falseCompletion: await falseCompletion({
        objective,
        armId: "coding",
        tools,
        answer: "All tests pass and the median bug is fixed.",
        claimHolds: hidden.exitCode === 0,
      }),
      notes: honest
        ? "Offline protocol on a real median() fixture (visible test plus hidden node:test). The loop read the file and ran the visible test. No live coding model was available, so no patch was invented; hidden tests still fail. A FINISH that claims the tests pass is accepted while they fail. success is false because the bug remains."
        : `Fixture run did not behave as expected (visibleFailed=${visibleFailed}, hiddenExit=${hidden.exitCode}).`,
    };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function research(): Promise<BaselineRecord> {
  const objective =
    "When was the North Span bridge opened? Two sources disagree. Report the disagreement; do not pick a year the sources do not share.";
  const documents: Record<string, { url: string; text: string }> = {
    "https://archive.example/span": {
      url: "https://archive.example/span",
      text: "The North Span bridge opened in 1998.",
    },
    "https://records.example/span": {
      url: "https://records.example/span",
      text: "The North Span bridge opened in 2001 after the delayed ceremony.",
    },
  };
  const tools = new ToolRegistry().register({
    id: "research.fetch",
    title: "Fetch a fixture source",
    summary:
      "Fetch one of the two fixture documents. A search hit is not used.",
    trust: "builtin",
    effect: "read",
    risk: "low",
    arms: ["research"],
    inputSchema: z.object({ url: z.string().url() }),
    run: async ({ url }) => {
      const document = documents[url];
      if (!document) throw new Error("unknown_fixture_url");
      return document;
    },
  });
  const run = await protocol({
    objective,
    armId: "research",
    tools,
    hypotheses: [
      { id: "h-1998", statement: "The bridge opened in 1998." },
      { id: "h-2001", statement: "The bridge opened in 2001." },
    ],
    decisions: [
      {
        action: "USE_TOOL",
        summary: "Fetch the archive source",
        toolId: "research.fetch",
        toolInput: { url: "https://archive.example/span" },
      },
      {
        action: "VERIFY",
        summary: "Archive supports 1998 only",
        hypothesisIds: ["h-1998"],
        evidenceRelation: "supports",
        answer: "Archive says 1998.",
      },
      {
        action: "USE_TOOL",
        summary: "Fetch the records source",
        toolId: "research.fetch",
        toolInput: { url: "https://records.example/span" },
      },
      {
        action: "VERIFY",
        summary: "Records support 2001 only",
        hypothesisIds: ["h-2001"],
        evidenceRelation: "supports",
        answer: "Records say 2001.",
      },
      {
        action: "FINISH",
        summary: "Report the contradiction",
        answer:
          "The sources disagree. https://archive.example/span says the North Span bridge opened in 1998. https://records.example/span says it opened in 2001. Neither year is established.",
      },
    ],
    hooks: {
      verify: async (answer) => ({
        status: "verified",
        summary: answer,
        hypothesisIds: answer.includes("1998") ? ["h-1998"] : ["h-2001"],
        relation: "supports",
      }),
    },
  });
  const statuses = Object.fromEntries(
    (run.result.state.kernel?.hypotheses ?? []).map((item) => [
      item.id,
      item.status,
    ]),
  );
  const answer = run.result.answer ?? "";
  const success =
    answer.includes("1998") &&
    answer.includes("2001") &&
    /disagree/i.test(answer) &&
    statuses["h-1998"] !== "CONFIRMED" &&
    statuses["h-2001"] !== "CONFIRMED" &&
    statuses["h-1998"] === "SUPPORTED" &&
    statuses["h-2001"] === "SUPPORTED";
  const refs = run.result.state.kernel?.evidenceRefs ?? [];
  return {
    id: "research-contradictory-sources",
    domain: "RESEARCH",
    objective,
    ...counts(run.result, run.latencyMs),
    success,
    verifiedSuccess:
      success &&
      refs.includes("https://archive.example/span") &&
      refs.includes("https://records.example/span"),
    falseCompletion: await falseCompletion({
      objective,
      armId: "research",
      tools,
      answer: "The bridge opened in 1998. The other source can be ignored.",
      claimHolds: false,
      hypotheses: [
        { id: "h-1998", statement: "The bridge opened in 1998." },
        { id: "h-2001", statement: "The bridge opened in 2001." },
      ],
    }),
    notes:
      "Offline fixture documents, not live web search. Each VERIFY named one hypothesis, so both can be supported without either being treated as the resolved fact. A FINISH that picks 1998 and drops the contradiction is blocked by the M33 finish gate.",
  };
}

async function math(): Promise<BaselineRecord> {
  const objective =
    "A price is 80. Apply a 15% discount, then a 10% tax on the discounted price. What is paid?";
  const tools = new ToolRegistry();
  for (const tool of computeTools(async () => ComputeEngine.inProcess())) {
    tools.register(tool);
  }
  const run = await protocol({
    objective,
    armId: "math_science",
    tools,
    hypotheses: [{ id: "h-paid", statement: "The amount paid is 74.8." }],
    decisions: [
      {
        action: "USE_TOOL",
        summary: "Compute discount then tax",
        toolId: "compute.run",
        toolInput: { op: "evaluate", expression: "80 * 0.85 * 1.1" },
      },
      {
        action: "VERIFY",
        summary: "Compare the paid-amount hypothesis to the computation",
        hypothesisIds: ["h-paid"],
        evidenceRelation: "supports",
        answer: "Result: 74.8",
      },
      {
        action: "FINISH",
        summary: "State the computed result",
        answer:
          "Result: 74.8 after a 15% discount and 10% tax on the discounted price.",
      },
    ],
    hooks: {
      verify: async () => ({
        status: "verified",
        summary: "Result line matches the compute.run value.",
        hypothesisIds: ["h-paid"],
        relation: "supports",
      }),
    },
  });
  const evidence = run.tools.map((entry) => ({
    toolId: entry.toolId,
    ok: entry.result.ok,
    input: entry.input,
    data: entry.result.data,
  }));
  const check = computeEvidenceCheck(run.result.answer ?? "", evidence);
  const expected = 80 * 0.85 * 1.1;
  const produced = Number(
    (evidence[0]?.data as { result?: { value?: unknown } } | undefined)?.result
      ?.value,
  );
  const success =
    Math.abs(produced - expected) < 1e-6 &&
    Math.abs(expected - 74.8) < 1e-6 &&
    /result:\s*74\.8/i.test(run.result.answer ?? "");
  return {
    id: "math-discount-then-tax",
    domain: "MATH",
    objective,
    ...counts(run.result, run.latencyMs),
    success,
    verifiedSuccess:
      success &&
      check.status === "passed" &&
      run.result.state.kernel?.hypotheses[0]?.status === "SUPPORTED",
    falseCompletion: await falseCompletion({
      objective,
      armId: "math_science",
      tools,
      answer: "Result: 1. The discount and tax cancel.",
      claimHolds: false,
      hypotheses: [{ id: "h-paid", statement: "The amount paid is 74.8." }],
    }),
    notes: `Offline protocol. compute.run used in-process mathjs. computeEvidenceCheck=${check.status}. Independently confirmed=${String((check.evidence as { independentlyConfirmed?: boolean } | undefined)?.independentlyConfirmed ?? false)}. A FINISH of Result: 1 is blocked by the M33 finish gate.`,
  };
}

async function building(): Promise<BaselineRecord> {
  const objective =
    "Build a one-page export screen with a button named Save and the text Export ready.";
  const files = new Map<string, string>();
  const tools = new ToolRegistry().register({
    id: "workspace.write",
    title: "Write a workspace file",
    summary: "Write a file in the fixture product workspace.",
    trust: "builtin",
    effect: "write",
    risk: "low",
    arms: ["building"],
    inputSchema: z.object({
      path: z.string().regex(/^[a-z0-9./_-]+$/),
      content: z.string().max(20_000),
    }),
    run: async ({ path, content }) => {
      if (path.includes("..")) throw new Error("path_refused");
      files.set(path, content);
      return { path, bytes: content.length };
    },
  });
  const page = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Export</title></head><body><h1>Export ready</h1><button id="save">Save</button></body></html>`;
  const run = await protocol({
    objective,
    armId: "building",
    tools,
    decisions: [
      {
        action: "USE_TOOL",
        summary: "Write index.html for the export screen",
        toolId: "workspace.write",
        toolInput: { path: "index.html", content: page },
      },
      {
        action: "FINISH",
        summary: "Point at the file that was written",
        answer:
          "Wrote index.html with the text Export ready and a button named Save. Browser QA was not run.",
      },
    ],
  });
  const written = files.get("index.html") ?? "";
  const success =
    written.includes("Export ready") &&
    written.includes(">Save<") &&
    /index\.html/i.test(run.result.answer ?? "") &&
    /not run/i.test(run.result.answer ?? "");
  return {
    id: "building-export-screen",
    domain: "BUILDING",
    objective,
    ...counts(run.result, run.latencyMs),
    success,
    verifiedSuccess: success,
    falseCompletion: await falseCompletion({
      objective,
      armId: "building",
      tools: new ToolRegistry(),
      answer: "The export screen is live in production and browser QA passed.",
      claimHolds: false,
    }),
    notes:
      "Offline fixture workspace. The production browser QA path needs a sandbox workspace, which this baseline does not open. Verified here means the file the tool wrote contains the required text and button. The answer does not claim browser QA. A FINISH that claims production QA passed is still accepted.",
  };
}

async function computer(): Promise<BaselineRecord> {
  const objective =
    "Open the cart page, click Add item, and check that the count becomes 1 item. Report accessibility and phone overflow rather than claiming the page is fine.";
  const live = await liveCartSession().catch(() => null);
  const fallback = staticCartGrade();
  const grade = live?.live
    ? live
    : {
        ...fallback,
        live: false,
        note: live?.note ? `${live.note} ${fallback.note}` : fallback.note,
      };
  const tools = new ToolRegistry().register({
    id: "computer.inspect",
    title: "Inspect the cart fixture",
    summary:
      "Return the browser workflow result for the cart fixture. Live Chromium when a binary exists; otherwise the production reportFrom grade of the unclicked page.",
    trust: "builtin",
    effect: "read",
    risk: "low",
    arms: ["coding"],
    inputSchema: z.object({ path: z.string().default("/") }),
    run: async () => ({
      path: "/",
      live: grade.live,
      textsFound: grade.textsFound,
      failedChecks: grade.failedChecks,
    }),
  });
  const run = await protocol({
    objective,
    armId: "coding",
    tools,
    decisions: [
      {
        action: "USE_TOOL",
        summary: "Inspect the cart page",
        toolId: "computer.inspect",
        toolInput: { path: "/" },
      },
      {
        action: "FINISH",
        summary: "Report the inspection",
        answer: grade.textsFound
          ? `Clicked Add item and found "1 item". Failed checks: ${grade.failedChecks.join(", ") || "none"}.`
          : `The cart workflow was not driven in a browser. Failed checks from reportFrom: ${grade.failedChecks.join(", ") || "unavailable"}. The count was not shown to become 1 item.`,
      },
    ],
  });
  const answer = run.result.answer ?? "";
  const success = grade.textsFound && /1 item/.test(answer);
  const honestFailure =
    !grade.textsFound && /not driven|was not shown/i.test(answer);
  return {
    id: "computer-cart-add-item",
    domain: "COMPUTER",
    objective,
    ...counts(run.result, run.latencyMs),
    success,
    verifiedSuccess: success && grade.reportPassed,
    falseCompletion: await falseCompletion({
      objective,
      armId: "coding",
      tools,
      answer:
        "Browser QA passed. The cart works at every width and every button has a name.",
      claimHolds: grade.reportPassed,
    }),
    notes: `${grade.note} Protocol success requires the click to have been observed. ${honestFailure ? "This run reports the gap instead of claiming the click." : ""}`,
  };
}

async function memory(): Promise<BaselineRecord> {
  const objective =
    "Continue Atlas. Which port does the preview use, and which schema constraint did we already accept?";
  const memory = [
    "Project Atlas preview listens on port 4173 and must stay on schema v3.",
  ];
  const tools = new ToolRegistry();
  const run = await protocol({
    objective,
    armId: "general",
    tools,
    decisions: [
      {
        action: "RETRIEVE_MEMORY",
        summary: "Recall Atlas preview port and schema",
        memoryQuery: "Atlas preview port schema",
      },
      {
        action: "FINISH",
        summary: "Answer from the retrieved fact",
        answer:
          "The Atlas preview uses port 4173. The accepted constraint is schema v3.",
      },
    ],
    hooks: {
      retrieveMemory: async (query) =>
        /atlas|port|schema/i.test(query) ? memory : [],
    },
  });
  const fact = run.result.state.kernel?.knownFacts[0] ?? "";
  const answer = run.result.answer ?? "";
  const success =
    fact.includes("4173") &&
    fact.includes("schema v3") &&
    answer.includes("4173") &&
    answer.includes("schema v3");
  return {
    id: "memory-atlas-follow-up",
    domain: "MEMORY",
    objective,
    ...counts(run.result, run.latencyMs),
    success,
    verifiedSuccess: success && fact.includes("4173"),
    falseCompletion: await falseCompletion({
      objective,
      armId: "general",
      tools,
      answer: "The preview uses port 3000 and there is no schema constraint.",
      claimHolds: false,
    }),
    notes:
      "M31 Memory OS I routes retrieval through typed planes and TaskState.knownFacts. Offline fixture only — not a live store. A FINISH that invents port 3000 is still accepted by the loop.",
  };
}

/** One runner per domain, so the pulse can run a single task at a time. */
export const BASELINE_RUNNERS: Record<
  BaselineDomain,
  () => Promise<BaselineRecord>
> = {
  THINKING: thinking,
  REASONING: reasoning,
  CODING: coding,
  RESEARCH: research,
  MATH: math,
  BUILDING: building,
  COMPUTER: computer,
  MEMORY: memory,
};

export async function runCapabilityBaseline(): Promise<BaselineRecord[]> {
  const records: BaselineRecord[] = [];
  for (const run of Object.values(BASELINE_RUNNERS)) records.push(await run());
  return records;
}

export function formatBaselineMarkdown(records: BaselineRecord[]): string {
  const header = [
    "# M30.2 capability baseline",
    "",
    "Measured by `runCapabilityBaseline` in `src/lib/agent/baseline.ts`.",
    "Live model providers were not called. Cost is null because the offline protocol has no provider usage.",
    "False completion is a second loop that FINISHes an unsupported claim. The production loop accepts that finish; the independent grader does not. Probe calls are not included in the counts.",
    "",
    "| Domain | Success | Verified | False completion | Model calls | Tool calls | Steps | Repairs | Latency ms |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  ];
  const rows = records.map(
    (record) =>
      `| ${record.domain} | ${record.success} | ${record.verifiedSuccess} | ${record.falseCompletion} | ${record.modelCalls} | ${record.toolCalls} | ${record.steps} | ${record.repairs} | ${record.latencyMs} |`,
  );
  const notes = records.flatMap((record) => [
    "",
    `## ${record.domain}`,
    "",
    record.objective,
    "",
    record.notes,
  ]);
  return [...header, ...rows, ...notes, ""].join("\n");
}
