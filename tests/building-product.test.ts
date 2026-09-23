import { existsSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { armFor } from "../src/lib/arms/registry";
import type { ArmStageContext } from "../src/lib/arms/types";
import {
  buildContractSchema,
  contractCoverage,
  contractProbes,
  contractProblems,
  isProductBuild,
  previewDirectory,
} from "../src/lib/building/contract";
import {
  HttpPreviewCheck,
  serveWorkspaceDirectory,
  type QaReport,
} from "../src/lib/coding/browser-qa";
import { PlaywrightQa } from "../src/lib/coding/playwright-qa";
import { WorkspaceSession } from "../src/lib/coding/session";
import { MemoryWorkspaceStore } from "../src/lib/coding/store";
import { LocalWorkspaceDriver } from "../src/lib/sandbox/local";

// Building V2 on a fixture: a contract, a real static page in a real
// workspace, a real HTTP server, and -- where Chromium is installed -- a real
// browser. The model is not in this test; the page stands in for what the
// agent loop writes, and the verifier is the production code.

const CHROMIUM = [
  process.env.OSIRUS_CHROMIUM_PATH,
  "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
].find((path): path is string => Boolean(path && existsSync(path)));

async function playwrightUsable() {
  try {
    const { chromium } = await import("playwright-core");
    const browser = await chromium.launch({
      executablePath: CHROMIUM,
      args: ["--no-sandbox"],
    });
    await browser.close();
    return true;
  } catch {
    return false;
  }
}

const objective =
  "Build a landing page for a coffee subscription with a signup form";

const contract = buildContractSchema.parse({
  product: "Coffee subscription landing page",
  stack: "static-html",
  screens: [
    {
      id: "home",
      name: "Home",
      path: "/",
      purpose: "Explain the subscription and collect signups",
      components: ["hero", "signup"],
      states: ["success", "error"],
      acceptance: {
        texts: ["Fresh coffee, every week"],
        selectors: ["#signup-form", "button[type=submit]"],
      },
    },
  ],
  components: [
    { id: "hero", name: "Hero", responsibility: "Headline and pitch" },
    { id: "signup", name: "Signup form", responsibility: "Collect email" },
  ],
});

const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Beanbox</title>
<style>body{font-family:sans-serif;margin:0;padding:16px;max-width:720px}input{max-width:100%}</style>
</head>
<body>
<main>
<h1>Fresh coffee, every week</h1>
<img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" alt="Coffee beans">
<form id="signup-form">
<label for="email">Email</label>
<input id="email" type="email" required>
<button type="submit">Subscribe</button>
<p id="status" role="status"></p>
</form>
</main>
<script>
document.getElementById("signup-form").addEventListener("submit", (event) => {
  event.preventDefault();
  document.getElementById("status").textContent = "Thanks! Check your inbox.";
});
</script>
</body>
</html>
`;

function verifyContext(state: Record<string, unknown>) {
  return {
    identity: { userId: "u", organizationId: "o", workspaceId: "w" },
    work: {
      runId: "11111111-1111-4111-8111-111111111111",
      stageId: "22222222-2222-4222-8222-222222222222",
      objective,
      stageInput: { stageKind: "verify" },
    },
    runtime: {
      provider: {
        structured: async () => ({
          value: { verdict: "pass", reason: "complete" },
          usage: {},
        }),
      },
    },
    state,
  } as unknown as ArmStageContext;
}

let session: WorkspaceSession;
let browserReport: QaReport | null = null;
let httpReport: QaReport;

beforeAll(async () => {
  ({ session } = await WorkspaceSession.open({
    driver: new LocalWorkspaceDriver(),
    store: new MemoryWorkspaceStore(),
    runId: crypto.randomUUID(),
    fixture: [{ path: "README.md", content: "# Beanbox\n" }],
    install: false,
  }));
  // What the agent loop would have written.
  await session.workspace.write("index.html", PAGE);
  await session.refresh();

  const files = await session.workspace.tree(".", 4, { filesOnly: true });
  const directory = previewDirectory(files)!;
  const served = await serveWorkspaceDirectory(session.workspace, directory);
  try {
    httpReport = await new HttpPreviewCheck().run(
      served.url,
      contractProbes(contract),
    );
    if (await playwrightUsable())
      browserReport = await new PlaywrightQa(CHROMIUM).run(
        served.url,
        contractProbes(contract),
      );
  } finally {
    await served.close();
  }
}, 60_000);

afterAll(async () => {
  await session?.destroy();
});

describe("build contract", () => {
  it("tells a product build from a document", () => {
    expect(isProductBuild(objective)).toBe(true);
    expect(
      isProductBuild("Draft a specification document covering the rollout"),
    ).toBe(false);
    expect(
      armFor("building")
        .buildWorkflow({ objective, capabilities: [] })
        .nodes.map((node) => node.key),
    ).toEqual(
      expect.arrayContaining([
        "open-workspace",
        "run-checks",
        "qa-preview",
        "finalize-workspace",
      ]),
    );
  });

  it("requires an acceptance probe on every screen", () => {
    expect(contractProblems(contract)).toEqual([]);
    const withoutProbe = buildContractSchema.parse({
      ...contract,
      screens: [
        { ...contract.screens[0], acceptance: { texts: [], selectors: [] } },
      ],
    });
    expect(contractProblems(withoutProbe).join(" ")).toMatch(
      /no acceptance probe/,
    );
  });
});

describe("preview QA on the fixture", () => {
  it("serves the built page and checks its markup over HTTP", () => {
    expect(httpReport.mode).toBe("http");
    expect(httpReport.status).toBe(200);
    expect(
      httpReport.checks.find((check) => check.id.startsWith("text:"))?.passed,
    ).toBe(true);
  });

  it("verifies the product only on browser evidence", async () => {
    // HTTP-only evidence caps the verdict: nothing was rendered.
    const httpVerdict = await armFor("building").verify(
      verifyContext({
        answer: "Built index.html with the hero and the signup form.",
        buildContract: contract,
        qaReport: httpReport,
        workspaceDiff: "+ index.html",
        workspace: { status: "stopped", commands: [] },
      }),
    );
    expect(httpVerdict.status).toBe("unverified");

    if (!browserReport) return; // No Chromium here; the CI job installs it.
    expect(browserReport.mode).toBe("browser");
    expect(browserReport.consoleErrors).toEqual([]);
    expect(browserReport.viewports.map((viewport) => viewport.name)).toEqual([
      "desktop",
      "ipad",
      "phone",
    ]);
    expect(contractCoverage(contract, browserReport).missing).toEqual([]);
    const verdict = await armFor("building").verify(
      verifyContext({
        answer: "Built index.html with the hero and the signup form.",
        buildContract: contract,
        qaReport: browserReport,
        workspaceDiff: "+ index.html",
        workspace: { status: "stopped", commands: [] },
      }),
    );
    expect(verdict.status, verdict.summary).toBe("verified");
  });

  it("rejects a page missing what the contract promised", async () => {
    if (!browserReport) return;
    const broken: QaReport = {
      ...browserReport,
      checks: browserReport.checks.map((check) =>
        check.id === "selector:#signup-form"
          ? {
              ...check,
              passed: false,
              detail: "0 element(s) match #signup-form.",
            }
          : check,
      ),
    };
    const verdict = await armFor("building").verify(
      verifyContext({
        answer: "Built the landing page.",
        buildContract: contract,
        qaReport: broken,
        workspaceDiff: "+ index.html",
        workspace: { status: "stopped", commands: [] },
      }),
    );
    expect(verdict.status).toBe("rejected");
  });

  it("rejects a product build answered with prose", async () => {
    const verdict = await armFor("building").verify(
      verifyContext({
        answer:
          "The landing page would have a hero section with the headline and a signup form below it.",
        buildContract: contract,
      }),
    );
    expect(verdict.status).toBe("rejected");
  });
});
