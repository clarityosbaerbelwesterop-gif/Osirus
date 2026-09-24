import { existsSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { z } from "zod";
import type { ArmId } from "../arms/types";
import { reportFrom, type BrowserSession } from "../computer/browser";
import { computeEvidenceCheck } from "../verification/compute-evidence";
import { ComputeEngine } from "../compute/engine";
import { computeTools } from "../compute/tools";
import {
  ToolRegistry,
  type ToolContext,
  type ToolResult,
} from "../tools/registry";
import type { AgentDecision } from "./decision";
import { runAgentLoop, type LoopHooks, type LoopResult } from "./loop";
import {
  formatObserveActVerify,
  observeActVerifyFromSession,
} from "./observe-act-verify";
import {
  applyGrounding,
  groundingFromAttachment,
  groundingFromBrowserSession,
} from "./multimodal-grounding";
import { verificationArtifactFromQa } from "../building/verification-artifact";
import { buildContractSchema } from "../building/contract";
import type { HypothesisSeed } from "./task-state";

// M38 capability pulse: Building, Computer, Tool Use and Multimodal at L1–L5.
//
// Offline fixtures over the production loop, OAV helpers and grounding — not a
// second runtime or hourly scheduler. Each level adds one capability layer:
// L1 observe, L2 act, L3 verify, L4 ground hypotheses, L5 build-prove with
// artifacts.

export const PULSE_LEVELS = [1, 2, 3, 4, 5] as const;
export type PulseLevel = (typeof PULSE_LEVELS)[number];

export const PULSE_SUITES = [
  "BUILDING",
  "COMPUTER",
  "TOOL_USE",
  "MULTIMODAL",
] as const;
export type PulseSuite = (typeof PULSE_SUITES)[number];

export type PulseRecord = {
  id: string;
  suite: PulseSuite;
  level: PulseLevel;
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
  runId: "55555555-5555-4555-8555-555555555555",
  stageId: "66666666-6666-4666-8666-666666666666",
  organizationId: "77777777-7777-4777-8777-777777777777",
  workspaceId: "88888888-8888-4888-8888-888888888888",
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
    "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  ];
  return candidates.find((path) => path && existsSync(path)) ?? null;
}

const CART_PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Cart</title></head>
<body><h1>Cart</h1><button id="add">Add item</button>
<p id="count">0 items</p>
<script>document.getElementById("add").onclick=()=>{document.getElementById("count").textContent="1 item";};</script>
</body></html>`;

const EXPORT_PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Export</title></head><body><h1>Export ready</h1><button id="save">Save</button></body></html>`;

type ToolLog = Array<{
  toolId: string;
  input: unknown;
  result: ToolResult;
}>;

async function protocol(input: {
  objective: string;
  armId: ArmId;
  tools: ToolRegistry;
  decisions: AgentDecision[];
  hypotheses?: HypothesisSeed[];
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

async function falseCompletion(input: {
  objective: string;
  armId: ArmId;
  tools: ToolRegistry;
  answer: string;
  claimHolds: boolean;
}): Promise<boolean> {
  const result = await runAgentLoop({
    objective: input.objective,
    directives: [],
    context: [],
    tools: input.tools,
    toolContext: context(input.armId),
    decide: async () => ({
      action: "FINISH",
      summary: "Claim the task is done",
      answer: input.answer,
    }),
  });
  return result.status === "finished" && !input.claimHolds;
}

function counts(result: LoopResult, latencyMs: number) {
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

function staticCartSession(clicked = false): BrowserSession {
  return {
    status: 200,
    title: "Cart",
    html: CART_PAGE,
    visibleText: clicked ? "Cart\nAdd item\n1 item" : "Cart\nAdd item\n0 items",
    consoleErrors: [],
    failedRequests: [],
    actions: clicked
      ? [
          {
            type: "click",
            selector: "#add",
            ok: true,
            detail: "clicked #add",
          },
        ]
      : [],
    viewports: [
      { name: "desktop", horizontalOverflow: false, screenshotBytes: 0 },
      { name: "phone", horizontalOverflow: false, screenshotBytes: 0 },
    ],
    a11y: { unnamedButtons: 0, imagesWithoutAlt: 0, unlabelledInputs: 0 },
    selectors: [{ selector: "#add", count: 1 }],
    texts: [{ text: "1 item", found: clicked }],
  };
}

async function liveCartSession(
  clicked = false,
): Promise<{ live: boolean; session: BrowserSession; url: string }> {
  const executable = browserBinary();
  if (!executable) {
    return {
      live: false,
      session: staticCartSession(clicked),
      url: "http://127.0.0.1/",
    };
  }
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
      await page.goto(url, { waitUntil: "domcontentloaded" });
      if (clicked) await page.click("#add");
      const countText = await page.locator("#count").innerText();
      const session: BrowserSession = {
        status: 200,
        title: await page.title(),
        html: await page.content(),
        visibleText: await page.locator("body").innerText(),
        consoleErrors: [],
        failedRequests: [],
        actions: clicked
          ? [
              {
                type: "click",
                selector: "#add",
                ok: true,
                detail: "clicked #add",
              },
            ]
          : [],
        viewports: [
          { name: "desktop", horizontalOverflow: false, screenshotBytes: 0 },
          { name: "phone", horizontalOverflow: false, screenshotBytes: 0 },
        ],
        a11y: { unnamedButtons: 0, imagesWithoutAlt: 0, unlabelledInputs: 0 },
        selectors: [{ selector: "#add", count: 1 }],
        texts: [{ text: "1 item", found: countText.includes("1 item") }],
      };
      return { live: true, session, url };
    } finally {
      await browser.close();
    }
  } finally {
    server.close();
  }
}

// --- BUILDING suite ---

async function buildingL1(): Promise<PulseRecord> {
  const objective =
    "Write index.html with Export ready text and a Save button.";
  const files = new Map<string, string>();
  const tools = new ToolRegistry().register({
    id: "workspace.write",
    title: "Write file",
    summary: "Write a workspace file.",
    trust: "builtin",
    effect: "write",
    risk: "low",
    arms: ["building"],
    inputSchema: z.object({ path: z.string(), content: z.string() }),
    run: async ({ path, content }) => {
      files.set(path, content);
      return { path, bytes: content.length };
    },
  });
  const run = await protocol({
    objective,
    armId: "building",
    tools,
    decisions: [
      {
        action: "USE_TOOL",
        summary: "Write index.html",
        toolId: "workspace.write",
        toolInput: { path: "index.html", content: EXPORT_PAGE },
      },
      {
        action: "FINISH",
        summary: "Report what was written",
        answer:
          "Wrote index.html containing Export ready and a Save button. Browser QA was not run.",
      },
    ],
  });
  const written = files.get("index.html") ?? "";
  const success =
    written.includes("Export ready") &&
    written.includes(">Save<") &&
    /not run/i.test(run.result.answer ?? "");
  return {
    id: "building-l1-scaffold",
    suite: "BUILDING",
    level: 1,
    objective,
    ...counts(run.result, run.latencyMs),
    success,
    verifiedSuccess: success,
    falseCompletion: await falseCompletion({
      objective,
      armId: "building",
      tools: new ToolRegistry(),
      answer: "The page is live and browser QA passed.",
      claimHolds: false,
    }),
    notes:
      "L1: scaffold only. Success means the file was written and the answer does not claim browser QA.",
  };
}

async function buildingL2(): Promise<PulseRecord> {
  const objective =
    "Serve the export page and report whether a browser or HTTP check ran.";
  const report = reportFrom("http://127.0.0.1/", staticCartSession(false), {
    texts: ["Export ready"],
  });
  const tools = new ToolRegistry().register({
    id: "qa.http",
    title: "HTTP check",
    summary: "HTTP-only preview check.",
    trust: "builtin",
    effect: "read",
    risk: "low",
    arms: ["building"],
    inputSchema: z.object({}),
    run: async () => ({
      mode: report.mode,
      failed: report.checks.filter((c) => !c.passed).map((c) => c.id),
    }),
  });
  const run = await protocol({
    objective,
    armId: "building",
    tools,
    decisions: [
      {
        action: "USE_TOOL",
        summary: "Run HTTP check",
        toolId: "qa.http",
        toolInput: {},
      },
      {
        action: "FINISH",
        summary: "Report HTTP-only QA",
        answer: `HTTP-only check ran (mode=${report.mode}). No browser rendered the page.`,
      },
    ],
  });
  const answer = run.result.answer ?? "";
  const success = /http/i.test(answer) && /no browser/i.test(answer);
  return {
    id: "building-l2-http-observe",
    suite: "BUILDING",
    level: 2,
    objective,
    ...counts(run.result, run.latencyMs),
    success,
    verifiedSuccess: success,
    falseCompletion: await falseCompletion({
      objective,
      armId: "building",
      tools,
      answer: "Browser QA passed at every viewport.",
      claimHolds: false,
    }),
    notes: "L2: act (HTTP fetch) + honest mode reporting.",
  };
}

async function buildingL3(): Promise<PulseRecord> {
  const objective = "Verify the export page against acceptance probes.";
  const oav = observeActVerifyFromSession(
    "http://127.0.0.1/",
    staticCartSession(false),
    { texts: ["Export ready"], selectors: ["#save"] },
  );
  const tools = new ToolRegistry();
  const run = await protocol({
    objective,
    armId: "building",
    tools,
    decisions: [
      {
        action: "FINISH",
        summary: "Report probe results",
        answer: formatObserveActVerify(oav),
      },
    ],
  });
  const success =
    oav.verify.checks.some((check) => check.id.startsWith("text:")) &&
    /Verify/i.test(run.result.answer ?? "");
  return {
    id: "building-l3-verify-probes",
    suite: "BUILDING",
    level: 3,
    objective,
    ...counts(run.result, run.latencyMs),
    success,
    verifiedSuccess: success,
    falseCompletion: await falseCompletion({
      objective,
      armId: "building",
      tools,
      answer: "All acceptance probes passed in a real browser.",
      claimHolds: oav.verify.passed,
    }),
    notes: "L3: verify probes via reportFrom on a fixture session.",
  };
}

async function buildingL4(): Promise<PulseRecord> {
  const objective = "Ground the export-ready hypothesis from browser evidence.";
  const session = staticCartSession(false);
  session.html = EXPORT_PAGE;
  session.visibleText = "Export ready\nSave";
  session.selectors = [{ selector: "#save", count: 1 }];
  session.texts = [{ text: "Export ready", found: true }];
  const tools = new ToolRegistry();
  const run = await protocol({
    objective,
    armId: "building",
    tools,
    hypotheses: [
      { id: "h-export", statement: "The export screen shows Export ready." },
    ],
    decisions: [
      {
        action: "VERIFY",
        summary: "Ground from DOM evidence",
        hypothesisIds: ["h-export"],
        evidenceRelation: "supports",
        answer: "Export ready text is in the page.",
      },
      {
        action: "FINISH",
        summary: "Report grounded hypothesis",
        answer: "Export ready is supported by DOM evidence.",
      },
    ],
    hooks: {
      verify: async () => ({
        status: "verified",
        summary: "Export ready found in visible text",
        hypothesisIds: ["h-export"],
        relation: "supports",
      }),
    },
  });
  const kernel = run.result.state.kernel;
  if (kernel) {
    applyGrounding(
      kernel,
      groundingFromBrowserSession(session, "http://127.0.0.1/", {
        hypothesisIds: ["h-export"],
        relation: "supports",
      }),
    );
  }
  const status = kernel?.hypotheses[0]?.status;
  const success = status === "SUPPORTED" || status === "CONFIRMED";
  return {
    id: "building-l4-ground-hypothesis",
    suite: "BUILDING",
    level: 4,
    objective,
    ...counts(run.result, run.latencyMs),
    success,
    verifiedSuccess: success,
    falseCompletion: await falseCompletion({
      objective,
      armId: "building",
      tools,
      answer: "Export ready is confirmed without evidence.",
      claimHolds: false,
    }),
    notes: "L4: multimodal grounding ties DOM refs to a named hypothesis.",
  };
}

async function buildingL5(): Promise<PulseRecord> {
  const objective =
    "Build and verify the export screen with a verification artifact.";
  const contract = buildContractSchema.parse({
    product: "Export screen",
    stack: "static-html",
    screens: [
      {
        id: "export",
        name: "Export",
        path: "/",
        purpose: "Export data",
        acceptance: { texts: ["Export ready"], selectors: ["#save"] },
      },
    ],
  });
  const qaSession: BrowserSession = {
    ...staticCartSession(false),
    html: EXPORT_PAGE,
    visibleText: "Export ready\nSave",
    texts: [{ text: "Export ready", found: true }],
    selectors: [{ selector: "#save", count: 1 }],
  };
  const report = reportFrom("http://127.0.0.1/", qaSession, {
    texts: ["Export ready"],
    selectors: ["#save"],
  });
  const artifact = verificationArtifactFromQa(contract, report);
  const tools = new ToolRegistry();
  const run = await protocol({
    objective,
    armId: "building",
    tools,
    decisions: [
      {
        action: "CREATE_ARTIFACT",
        summary: "Store verification report",
        artifact: {
          title: artifact.title,
          kind: artifact.kind,
          content: artifact.content,
        },
      },
      {
        action: "FINISH",
        summary: "Cite the artifact",
        answer: `Verification artifact ${artifact.title} stored. ${artifact.evidenceRefs.length} evidence ref(s).`,
      },
    ],
    hooks: {
      createArtifact: async () => ({ ref: "artifact:verification-export" }),
    },
  });
  const success =
    run.result.state.artifacts.some((a) => a.kind === "verification-report") &&
    /evidence ref/i.test(run.result.answer ?? "");
  return {
    id: "building-l5-build-prove",
    suite: "BUILDING",
    level: 5,
    objective,
    ...counts(run.result, run.latencyMs),
    success,
    verifiedSuccess: success && artifact.evidenceRefs.length > 0,
    falseCompletion: await falseCompletion({
      objective,
      armId: "building",
      tools,
      answer: "Verification artifact proves production QA passed.",
      claimHolds: report.checks.every((check) => check.passed),
    }),
    notes:
      "L5: build-prove loop with a verification artifact and evidence refs.",
  };
}

// --- COMPUTER suite ---

async function computerL1(): Promise<PulseRecord> {
  const { session, url } = await liveCartSession(false);
  const oav = observeActVerifyFromSession(url, session, {});
  const tools = new ToolRegistry().register({
    id: "computer.inspect",
    title: "Inspect",
    summary: "Observe the cart page.",
    trust: "builtin",
    effect: "read",
    risk: "low",
    arms: ["coding"],
    inputSchema: z.object({}),
    run: async () => ({
      ...oav.observe,
      evidenceRefs: oav.evidenceRefs,
    }),
  });
  const objective =
    "Open the cart page and report what is visible without clicking.";
  const run = await protocol({
    objective,
    armId: "coding",
    tools,
    decisions: [
      {
        action: "USE_TOOL",
        summary: "Observe cart",
        toolId: "computer.inspect",
        toolInput: {},
      },
      {
        action: "FINISH",
        summary: "Report observation",
        answer: `Visible: ${oav.observe.visibleText.slice(0, 120)}. No click was performed.`,
      },
    ],
  });
  const success =
    /0 items/i.test(run.result.answer ?? "") &&
    /no click/i.test(run.result.answer ?? "");
  return {
    id: "computer-l1-observe",
    suite: "COMPUTER",
    level: 1,
    objective,
    ...counts(run.result, run.latencyMs),
    success,
    verifiedSuccess: success,
    falseCompletion: await falseCompletion({
      objective,
      armId: "coding",
      tools,
      answer: "Clicked Add item and the count is 1 item.",
      claimHolds: false,
    }),
    notes: `L1: observe only. Live=${String(session.actions.length === 0)}.`,
  };
}

async function computerL2(): Promise<PulseRecord> {
  const { session, url } = await liveCartSession(true);
  const oav = observeActVerifyFromSession(url, session, { texts: ["1 item"] });
  const tools = new ToolRegistry().register({
    id: "computer.inspect",
    title: "Inspect",
    summary: "Click Add item.",
    trust: "builtin",
    effect: "read",
    risk: "low",
    arms: ["coding"],
    inputSchema: z.object({}),
    run: async () => ({
      actions: oav.acts,
      expectedText: session.texts,
      evidenceRefs: oav.evidenceRefs,
    }),
  });
  const objective = "Click Add item and report whether the count changed.";
  const run = await protocol({
    objective,
    armId: "coding",
    tools,
    decisions: [
      {
        action: "USE_TOOL",
        summary: "Click add",
        toolId: "computer.inspect",
        toolInput: {},
      },
      {
        action: "FINISH",
        summary: "Report click outcome",
        answer: session.texts[0]?.found
          ? 'Clicked Add item; count shows "1 item".'
          : 'Clicked Add item but "1 item" was not observed.',
      },
    ],
  });
  const success =
    session.texts[0]?.found === true && /1 item/i.test(run.result.answer ?? "");
  return {
    id: "computer-l2-act",
    suite: "COMPUTER",
    level: 2,
    objective,
    ...counts(run.result, run.latencyMs),
    success,
    verifiedSuccess: success,
    falseCompletion: await falseCompletion({
      objective,
      armId: "coding",
      tools,
      answer: "The cart shows 1 item without any click.",
      claimHolds: false,
    }),
    notes: "L2: single act + observe the DOM change.",
  };
}

async function computerL3(): Promise<PulseRecord> {
  const { session, url } = await liveCartSession(true);
  const oav = observeActVerifyFromSession(url, session, {
    selectors: ["#add"],
    texts: ["1 item"],
  });
  const objective = "Click Add item and verify acceptance probes.";
  const tools = new ToolRegistry();
  const run = await protocol({
    objective,
    armId: "coding",
    tools,
    decisions: [
      {
        action: "FINISH",
        summary: "Report verify outcome",
        answer: formatObserveActVerify(oav),
      },
    ],
  });
  const success =
    session.texts[0]?.found === true &&
    oav.verify.checks.some((check) => check.id.startsWith("selector:"));
  return {
    id: "computer-l3-verify",
    suite: "COMPUTER",
    level: 3,
    objective,
    ...counts(run.result, run.latencyMs),
    success,
    verifiedSuccess: success && oav.verify.passed,
    falseCompletion: await falseCompletion({
      objective,
      armId: "coding",
      tools,
      answer: "All probes passed; the cart is perfect.",
      claimHolds: oav.verify.passed,
    }),
    notes: `L3: verify probes after act. Failed checks: ${oav.verify.failedCheckIds.join(", ") || "none"}.`,
  };
}

async function computerL4(): Promise<PulseRecord> {
  const { session, url } = await liveCartSession(true);
  const tools = new ToolRegistry();
  const objective = "Ground the cart-count hypothesis from browser evidence.";
  const run = await protocol({
    objective,
    armId: "coding",
    tools,
    hypotheses: [
      { id: "h-count", statement: 'The cart shows "1 item" after Add.' },
    ],
    decisions: [
      {
        action: "VERIFY",
        summary: "Ground count hypothesis",
        hypothesisIds: ["h-count"],
        evidenceRelation: "supports",
        answer: session.texts[0]?.found ? "1 item found." : "1 item not found.",
      },
      {
        action: "FINISH",
        summary: "Report grounded state",
        answer: session.texts[0]?.found
          ? 'Hypothesis supported: "1 item" is visible.'
          : 'Hypothesis not supported: "1 item" was not found.',
      },
    ],
    hooks: {
      verify: async () => ({
        status: session.texts[0]?.found ? "verified" : "rejected",
        summary: session.texts[0]?.found ? "1 item visible" : "count unchanged",
        hypothesisIds: ["h-count"],
        relation: session.texts[0]?.found ? "supports" : "contradicts",
      }),
    },
  });
  const kernel = run.result.state.kernel;
  if (kernel) {
    applyGrounding(
      kernel,
      groundingFromBrowserSession(session, url, {
        hypothesisIds: ["h-count"],
        relation: session.texts[0]?.found ? "supports" : "contradicts",
      }),
    );
  }
  const status = kernel?.hypotheses[0]?.status;
  const expected = session.texts[0]?.found ? "SUPPORTED" : "WEAKENED";
  const success =
    status === expected || (session.texts[0]?.found && status === "CONFIRMED");
  return {
    id: "computer-l4-ground",
    suite: "COMPUTER",
    level: 4,
    objective,
    ...counts(run.result, run.latencyMs),
    success,
    verifiedSuccess: success,
    falseCompletion: await falseCompletion({
      objective,
      armId: "coding",
      tools,
      answer: "The count hypothesis is confirmed without browser evidence.",
      claimHolds: false,
    }),
    notes: "L4: browser evidence grounds a named hypothesis.",
  };
}

async function computerL5(): Promise<PulseRecord> {
  const { session, url } = await liveCartSession(true);
  const oav = observeActVerifyFromSession(url, session, {
    selectors: ["#add"],
    texts: ["1 item"],
  });
  const tools = new ToolRegistry().register({
    id: "computer.inspect",
    title: "Inspect",
    summary: "Full OAV cycle.",
    trust: "builtin",
    effect: "read",
    risk: "low",
    arms: ["coding"],
    inputSchema: z.object({}),
    run: async () => ({
      oav: formatObserveActVerify(oav),
      evidenceRefs: oav.evidenceRefs,
      passed: oav.verify.passed,
    }),
  });
  const objective = "Observe, act and verify the cart workflow end to end.";
  const run = await protocol({
    objective,
    armId: "coding",
    tools,
    decisions: [
      {
        action: "USE_TOOL",
        summary: "Run OAV",
        toolId: "computer.inspect",
        toolInput: {},
      },
      {
        action: "VERIFY",
        summary: "Check workflow",
        answer: oav.verify.summary,
      },
      {
        action: "FINISH",
        summary: "Report OAV",
        answer: `${oav.verify.summary} Evidence: ${oav.evidenceRefs.join(", ")}.`,
      },
    ],
    hooks: {
      verify: async () => ({
        status: oav.verify.passed ? "verified" : "rejected",
        summary: oav.verify.summary,
      }),
    },
  });
  const success =
    session.texts[0]?.found === true &&
    /Evidence:/i.test(run.result.answer ?? "");
  return {
    id: "computer-l5-oav",
    suite: "COMPUTER",
    level: 5,
    objective,
    ...counts(run.result, run.latencyMs),
    success,
    verifiedSuccess: success && oav.verify.passed,
    falseCompletion: await falseCompletion({
      objective,
      armId: "coding",
      tools,
      answer: "Full browser QA passed with screenshots at every width.",
      claimHolds: oav.verify.passed,
    }),
    notes: "L5: full observe→act→verify with evidence refs on the answer.",
  };
}

// --- TOOL_USE suite ---

async function toolUseL1(): Promise<PulseRecord> {
  const tools = new ToolRegistry().register({
    id: "fixture.echo",
    title: "Echo",
    summary: "Return the input.",
    trust: "builtin",
    effect: "read",
    risk: "low",
    arms: ["coding"],
    inputSchema: z.object({ message: z.string() }),
    run: async ({ message }) => ({ message }),
  });
  const objective = "Request the echo tool schema before using it.";
  const run = await runAgentLoop({
    objective,
    directives: [],
    context: [],
    tools,
    toolContext: context("coding"),
    decide: scripted([
      {
        action: "USE_TOOL",
        summary: "Request schema",
        requestSchemaFor: ["fixture.echo"],
      },
      {
        action: "FINISH",
        summary: "Schema received",
        answer: "Requested fixture.echo schema before calling it.",
      },
    ]),
  });
  const success =
    Boolean(run.state.disclosedSchemas["fixture.echo"]) &&
    /schema/i.test(run.answer ?? "");
  return {
    id: "tool-use-l1-schema",
    suite: "TOOL_USE",
    level: 1,
    objective,
    ...counts(run, 0),
    success,
    verifiedSuccess: success,
    falseCompletion: false,
    notes: "L1: progressive disclosure — schema before use.",
  };
}

async function toolUseL2(): Promise<PulseRecord> {
  const tools = new ToolRegistry().register({
    id: "fixture.echo",
    title: "Echo",
    summary: "Return the input.",
    trust: "builtin",
    effect: "read",
    risk: "low",
    arms: ["coding"],
    inputSchema: z.object({ message: z.string() }),
    run: async ({ message }) => ({
      message,
      evidenceRefs: [`echo:${message}`],
    }),
  });
  const objective = "Echo the word probe exactly once.";
  const run = await protocol({
    objective,
    armId: "coding",
    tools,
    decisions: [
      {
        action: "USE_TOOL",
        summary: "Echo probe",
        toolId: "fixture.echo",
        toolInput: { message: "probe" },
      },
      {
        action: "FINISH",
        summary: "Report echo",
        answer: "fixture.echo returned probe.",
      },
    ],
  });
  const success = run.tools.length === 1 && run.tools[0]?.result.ok === true;
  return {
    id: "tool-use-l2-single-call",
    suite: "TOOL_USE",
    level: 2,
    objective,
    ...counts(run.result, run.latencyMs),
    success,
    verifiedSuccess: success,
    falseCompletion: await falseCompletion({
      objective,
      armId: "coding",
      tools,
      answer: "fixture.echo returned something else.",
      claimHolds: false,
    }),
    notes: "L2: one correct tool call.",
  };
}

async function toolUseL3(): Promise<PulseRecord> {
  let calls = 0;
  const tools = new ToolRegistry().register({
    id: "fixture.flaky",
    title: "Flaky",
    summary: "Fails once then succeeds.",
    trust: "builtin",
    effect: "read",
    risk: "low",
    arms: ["coding"],
    inputSchema: z.object({}),
    run: async () => {
      calls += 1;
      if (calls === 1) throw new Error("transient_failure");
      return { ok: true, attempt: calls };
    },
  });
  const objective = "Call the flaky tool; replan after the first failure.";
  const run = await protocol({
    objective,
    armId: "coding",
    tools,
    decisions: [
      {
        action: "USE_TOOL",
        summary: "First attempt",
        toolId: "fixture.flaky",
        toolInput: {},
      },
      {
        action: "REPLAN",
        summary: "Retry after transient failure",
      },
      {
        action: "USE_TOOL",
        summary: "Second attempt",
        toolId: "fixture.flaky",
        toolInput: {},
      },
      {
        action: "FINISH",
        summary: "Report retry",
        answer: "Flaky tool succeeded on the second attempt after replan.",
      },
    ],
  });
  const success = calls === 2 && run.result.status === "finished";
  return {
    id: "tool-use-l3-retry",
    suite: "TOOL_USE",
    level: 3,
    objective,
    ...counts(run.result, run.latencyMs),
    success,
    verifiedSuccess: success,
    falseCompletion: false,
    notes: "L3: failure → replan → successful retry.",
  };
}

async function toolUseL4(): Promise<PulseRecord> {
  const tools = new ToolRegistry().register({
    id: "fixture.echo",
    title: "Echo",
    summary: "Return evidence refs.",
    trust: "builtin",
    effect: "read",
    risk: "low",
    arms: ["coding"],
    inputSchema: z.object({ message: z.string() }),
    run: async ({ message }) => ({
      message,
      evidenceRefs: [`echo:${message}`, `tool:fixture.echo`],
    }),
  });
  const objective = "Echo ground and attach evidence refs to the step.";
  const run = await protocol({
    objective,
    armId: "coding",
    tools,
    decisions: [
      {
        action: "USE_TOOL",
        summary: "Echo with refs",
        toolId: "fixture.echo",
        toolInput: { message: "ground" },
      },
      {
        action: "FINISH",
        summary: "Cite refs",
        answer: "Step recorded echo:ground evidence ref.",
      },
    ],
  });
  const step = run.result.state.steps.find((s) => s.toolId === "fixture.echo");
  const success =
    step?.evidenceRefs?.includes("echo:ground") === true &&
    /echo:ground/i.test(run.result.answer ?? "");
  return {
    id: "tool-use-l4-evidence-refs",
    suite: "TOOL_USE",
    level: 4,
    objective,
    ...counts(run.result, run.latencyMs),
    success,
    verifiedSuccess: success,
    falseCompletion: false,
    notes: "L4: tool evidence refs flow into loop steps.",
  };
}

async function toolUseL5(): Promise<PulseRecord> {
  const objective =
    "Compute 6 * 7 and verify the result with compute evidence.";
  const tools = new ToolRegistry();
  for (const tool of computeTools(async () => ComputeEngine.inProcess())) {
    tools.register(tool);
  }
  const run = await protocol({
    objective,
    armId: "math_science",
    tools,
    hypotheses: [{ id: "h-product", statement: "6 * 7 equals 42." }],
    decisions: [
      {
        action: "USE_TOOL",
        summary: "Compute product",
        toolId: "compute.run",
        toolInput: { op: "evaluate", expression: "6*7" },
      },
      {
        action: "VERIFY",
        summary: "Check hypothesis",
        hypothesisIds: ["h-product"],
        evidenceRelation: "supports",
        answer: "Result: 42",
      },
      {
        action: "FINISH",
        summary: "State result",
        answer: "Result: 42 from compute.run.",
      },
    ],
    hooks: {
      verify: async () => ({
        status: "verified",
        summary: "42 matches compute.run",
        hypothesisIds: ["h-product"],
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
  const success =
    check.status === "passed" && /result:\s*42/i.test(run.result.answer ?? "");
  return {
    id: "tool-use-l5-compute-verify",
    suite: "TOOL_USE",
    level: 5,
    objective,
    ...counts(run.result, run.latencyMs),
    success,
    verifiedSuccess: success,
    falseCompletion: await falseCompletion({
      objective,
      armId: "math_science",
      tools,
      answer: "Result: 42 without using compute.run.",
      claimHolds: false,
    }),
    notes: `L5: tool call + independent computeEvidenceCheck (${check.status}).`,
  };
}

// --- MULTIMODAL suite ---

async function multimodalL1(): Promise<PulseRecord> {
  const objective =
    "Read the design note attachment and quote the primary colour.";
  const tools = new ToolRegistry();
  const run = await protocol({
    objective,
    armId: "general",
    tools,
    decisions: [
      {
        action: "RETRIEVE_MEMORY",
        summary: "Fetch design note",
        memoryQuery: "design note colour",
      },
      {
        action: "FINISH",
        summary: "Quote colour",
        answer: "The design note says the primary colour is #2F6FED.",
      },
    ],
    hooks: {
      retrieveMemory: async () => [
        "Design note (attachment:design-1:chunk-1): primary colour #2F6FED.",
      ],
    },
  });
  const success = /#2F6FED/i.test(run.result.answer ?? "");
  return {
    id: "multimodal-l1-read-attachment",
    suite: "MULTIMODAL",
    level: 1,
    objective,
    ...counts(run.result, run.latencyMs),
    success,
    verifiedSuccess: success,
    falseCompletion: false,
    notes: "L1: read attachment-derived memory without inventing content.",
  };
}

async function multimodalL2(): Promise<PulseRecord> {
  const objective = "Ground the colour hypothesis from the design attachment.";
  const tools = new ToolRegistry();
  const run = await protocol({
    objective,
    armId: "general",
    tools,
    hypotheses: [{ id: "h-colour", statement: "Primary colour is #2F6FED." }],
    decisions: [
      {
        action: "VERIFY",
        summary: "Ground from attachment",
        hypothesisIds: ["h-colour"],
        evidenceRelation: "supports",
        answer: "Attachment chunk cites #2F6FED.",
      },
      {
        action: "FINISH",
        summary: "Report grounding",
        answer:
          "Primary colour #2F6FED grounded from attachment:design-1:chunk-1.",
      },
    ],
    hooks: {
      verify: async () => ({
        status: "verified",
        summary: "#2F6FED in attachment",
        hypothesisIds: ["h-colour"],
        relation: "supports",
      }),
    },
  });
  const kernel = run.result.state.kernel;
  if (kernel) {
    applyGrounding(
      kernel,
      groundingFromAttachment("design-1", "chunk-1", "primary colour #2F6FED", {
        hypothesisIds: ["h-colour"],
      }),
    );
  }
  const status = kernel?.hypotheses[0]?.status;
  const success =
    (status === "SUPPORTED" || status === "CONFIRMED") &&
    /attachment:design-1/i.test(run.result.answer ?? "");
  return {
    id: "multimodal-l2-ground-attachment",
    suite: "MULTIMODAL",
    level: 2,
    objective,
    ...counts(run.result, run.latencyMs),
    success,
    verifiedSuccess: success,
    falseCompletion: false,
    notes: "L2: attachment locator grounds a hypothesis.",
  };
}

async function multimodalL3(): Promise<PulseRecord> {
  const objective = "Describe what the wireframe image attachment shows.";
  const tools = new ToolRegistry();
  const run = await protocol({
    objective,
    armId: "general",
    tools,
    decisions: [
      {
        action: "FINISH",
        summary: "Describe wireframe metadata",
        answer:
          "Attachment wireframe.png (image) is present; no pixel analysis was run. Alt text in the brief says: signup form with email field.",
      },
    ],
  });
  const success =
    /wireframe/i.test(run.result.answer ?? "") &&
    /no pixel analysis|not run/i.test(run.result.answer ?? "");
  return {
    id: "multimodal-l3-image-metadata",
    suite: "MULTIMODAL",
    level: 3,
    objective,
    ...counts(run.result, run.latencyMs),
    success,
    verifiedSuccess: success,
    falseCompletion: await falseCompletion({
      objective,
      armId: "general",
      tools,
      answer: "The wireframe shows a checkout page with three steps.",
      claimHolds: false,
    }),
    notes: "L3: honest image metadata without claiming vision inference.",
  };
}

async function multimodalL4(): Promise<PulseRecord> {
  const session = staticCartSession(false);
  session.html = EXPORT_PAGE;
  session.visibleText = "Export ready\nSave";
  session.texts = [{ text: "Export ready", found: true }];
  const objective =
    "Cross-ground DOM and attachment evidence for the export screen.";
  const tools = new ToolRegistry();
  const run = await protocol({
    objective,
    armId: "building",
    tools,
    hypotheses: [
      { id: "h-export", statement: "Export ready appears on the built page." },
    ],
    decisions: [
      {
        action: "VERIFY",
        summary: "Ground DOM",
        hypothesisIds: ["h-export"],
        evidenceRelation: "supports",
        answer: "DOM shows Export ready.",
      },
      {
        action: "FINISH",
        summary: "Cross-ground",
        answer:
          "DOM evidence (Export ready) matches attachment:spec-1:chunk-2 (requires Export ready text).",
      },
    ],
    hooks: {
      verify: async () => ({
        status: "verified",
        summary: "DOM and spec agree on Export ready",
        hypothesisIds: ["h-export"],
        relation: "supports",
      }),
    },
  });
  const kernel = run.result.state.kernel;
  if (kernel) {
    applyGrounding(
      kernel,
      groundingFromBrowserSession(session, "http://127.0.0.1/", {
        hypothesisIds: ["h-export"],
      }),
    );
    applyGrounding(
      kernel,
      groundingFromAttachment(
        "spec-1",
        "chunk-2",
        "Screen must show Export ready",
        { hypothesisIds: ["h-export"] },
      ),
    );
  }
  const refs = kernel?.evidenceRefs ?? [];
  const success =
    refs.some((ref) => ref.startsWith("browser:")) &&
    refs.some((ref) => ref.startsWith("attachment:"));
  return {
    id: "multimodal-l4-cross-ground",
    suite: "MULTIMODAL",
    level: 4,
    objective,
    ...counts(run.result, run.latencyMs),
    success,
    verifiedSuccess: success,
    falseCompletion: false,
    notes: "L4: DOM + attachment refs on the same hypothesis.",
  };
}

async function multimodalL5(): Promise<PulseRecord> {
  const { session, url } = await liveCartSession(true);
  const oav = observeActVerifyFromSession(url, session, { texts: ["1 item"] });
  const objective =
    "Observe, act, verify and ground the cart workflow with multimodal evidence.";
  const tools = new ToolRegistry();
  const run = await protocol({
    objective,
    armId: "coding",
    tools,
    hypotheses: [
      { id: "h-cart", statement: 'After Add, the cart shows "1 item".' },
    ],
    decisions: [
      {
        action: "VERIFY",
        summary: "Ground OAV evidence",
        hypothesisIds: ["h-cart"],
        evidenceRelation: session.texts[0]?.found ? "supports" : "contradicts",
        answer: oav.verify.summary,
      },
      {
        action: "FINISH",
        summary: "Report multimodal OAV",
        answer: `${formatObserveActVerify(oav)} Hypothesis grounded with ${oav.evidenceRefs.length} ref(s).`,
      },
    ],
    hooks: {
      verify: async () => ({
        status: session.texts[0]?.found ? "verified" : "rejected",
        summary: oav.verify.summary,
        hypothesisIds: ["h-cart"],
        relation: session.texts[0]?.found ? "supports" : "contradicts",
      }),
    },
  });
  const kernel = run.result.state.kernel;
  if (kernel) {
    applyGrounding(
      kernel,
      groundingFromBrowserSession(session, url, { hypothesisIds: ["h-cart"] }),
    );
  }
  const success =
    session.texts[0]?.found === true && (kernel?.evidenceRefs.length ?? 0) > 0;
  return {
    id: "multimodal-l5-oav-ground",
    suite: "MULTIMODAL",
    level: 5,
    objective,
    ...counts(run.result, run.latencyMs),
    success,
    verifiedSuccess: success,
    falseCompletion: await falseCompletion({
      objective,
      armId: "coding",
      tools,
      answer:
        "Multimodal evidence confirms the cart without any browser session.",
      claimHolds: false,
    }),
    notes: "L5: full OAV with multimodal grounding on a named hypothesis.",
  };
}

const PULSE_RUNNERS: Array<() => Promise<PulseRecord>> = [
  buildingL1,
  buildingL2,
  buildingL3,
  buildingL4,
  buildingL5,
  computerL1,
  computerL2,
  computerL3,
  computerL4,
  computerL5,
  toolUseL1,
  toolUseL2,
  toolUseL3,
  toolUseL4,
  toolUseL5,
  multimodalL1,
  multimodalL2,
  multimodalL3,
  multimodalL4,
  multimodalL5,
];

export async function runPulseSuite(filter?: {
  suite?: PulseSuite;
  level?: PulseLevel;
}): Promise<PulseRecord[]> {
  const records: PulseRecord[] = [];
  for (const runner of PULSE_RUNNERS) {
    const record = await runner();
    if (filter?.suite && record.suite !== filter.suite) continue;
    if (filter?.level && record.level !== filter.level) continue;
    records.push(record);
  }
  return records;
}

export function formatPulseMarkdown(records: PulseRecord[]): string {
  const header = [
    "# M38 capability pulse",
    "",
    "Measured by `runPulseSuite` in `src/lib/agent/pulse.ts`.",
    "Offline fixtures over the production loop. L1 observe → L5 build-prove.",
    "False completion is a second FINISH with an unsupported claim.",
    "",
    "| Suite | Level | Success | Verified | False completion | Tool calls | Steps | Latency ms |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
  ];
  const rows = records.map(
    (record) =>
      `| ${record.suite} | L${record.level} | ${record.success} | ${record.verifiedSuccess} | ${record.falseCompletion} | ${record.toolCalls} | ${record.steps} | ${record.latencyMs} |`,
  );
  const notes = records.flatMap((record) => [
    "",
    `## ${record.suite} L${record.level} — ${record.id}`,
    "",
    record.objective,
    "",
    record.notes,
  ]);
  return [...header, ...rows, ...notes, ""].join("\n");
}
