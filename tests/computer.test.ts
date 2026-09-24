import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { reportFrom, SandboxBrowser } from "../src/lib/computer/browser";
import { LocalWorkspaceDriver } from "../src/lib/sandbox/local";

// The in-VM browser program, run for real against a local page. It installs
// playwright-core from the npm registry and drives a local Chromium, so it
// runs only where OSIRUS_BROWSER_TEST=1 and a browser path are set; the VM
// path (Chromium from @sparticuz) is exercised by the live check in CI.
const chromium =
  process.env.OSIRUS_CHROMIUM_PATH ??
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
const enabled = process.env.OSIRUS_BROWSER_TEST === "1" && Boolean(chromium);

const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Cart</title></head>
<body><h1>Cart</h1><button id="add">Add item</button><button id="icon"></button>
<p id="count">0 items</p><div style="width:1200px">wide</div>
<script>document.getElementById("add").onclick=()=>{document.getElementById("count").textContent="1 item";};
console.error("boom");</script></body></html>`;

describe("computer arm", () => {
  it("turns a browser session into QA evidence", () => {
    const report = reportFrom(
      "http://localhost:4173/",
      {
        status: 200,
        title: "Cart",
        html: PAGE,
        consoleErrors: ["boom"],
        failedRequests: [],
        actions: [],
        viewports: [
          { name: "desktop", horizontalOverflow: false, screenshotBytes: 10 },
          { name: "phone", horizontalOverflow: true, screenshotBytes: 10 },
        ],
        a11y: { unnamedButtons: 1, imagesWithoutAlt: 0, unlabelledInputs: 0 },
        selectors: [{ selector: "#add", count: 1 }],
        texts: [],
      },
      { selectors: ["#add"] },
    );
    const failed = report.checks
      .filter((check) => !check.passed)
      .map((check) => check.id);
    expect(report.mode).toBe("browser");
    expect(failed).toEqual(["buttons-have-names", "no-overflow:phone"]);
  });

  it.skipIf(!enabled)(
    "drives a real browser in a workspace: actions, console, a11y, overflow",
    async () => {
      const server = createServer((_, response) => {
        response.writeHead(200, { "content-type": "text/html" });
        response.end(PAGE);
      });
      await new Promise<void>((resolve) =>
        server.listen(0, "127.0.0.1", resolve),
      );
      const port = (server.address() as AddressInfo).port;
      const handle = await new LocalWorkspaceDriver().create();
      try {
        const browser = new SandboxBrowser(handle, {
          chromiumPath: chromium,
          packages: ["playwright-core@1.63.0"],
          installEnv: Object.fromEntries(
            [
              "HTTPS_PROXY",
              "HTTP_PROXY",
              "NODE_EXTRA_CA_CERTS",
              "npm_config_cafile",
            ].flatMap((key) =>
              process.env[key] ? [[key, process.env[key]!]] : [],
            ),
          ),
        });
        const session = await browser.session({
          url: `http://127.0.0.1:${port}/`,
          actions: [
            { type: "click", selector: "#add" },
            { type: "click", selector: "#missing" },
          ],
          texts: ["1 item"],
        });
        expect(session.status).toBe(200);
        expect(session.actions.map((action) => action.ok)).toEqual([
          true,
          false,
        ]);
        expect(session.texts).toEqual([{ text: "1 item", found: true }]);
        expect(session.consoleErrors).toEqual(["boom"]);
        expect(session.a11y.unnamedButtons).toBe(1);
        expect(
          session.viewports.find((viewport) => viewport.name === "phone")
            ?.horizontalOverflow,
        ).toBe(true);
      } finally {
        await handle.destroy?.();
        server.close();
      }
    },
    300_000,
  );
});
