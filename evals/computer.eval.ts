import { describe, expect, it } from "vitest";
import { SandboxBrowser } from "../src/lib/computer/browser";
import { resolveSandbox } from "../src/lib/sandbox";

// The computer arm in the real Vercel Sandbox: install the browser in the VM,
// serve a page there, drive it at localhost. No model is involved.

const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Probe</title></head>
<body><main><h1>Probe</h1><button id="go">Go</button><p id="out">idle</p></main>
<script>document.getElementById("go").onclick=()=>{document.getElementById("out").textContent="clicked";};</script>
</body></html>`;

describe("computer arm in Vercel Sandbox (live)", () => {
  it("installs Chromium in the VM and drives a page there", async () => {
    const driver = await resolveSandbox();
    expect(driver.availability().configured).toBe(true);
    const handle = await driver.create({
      ports: [4173],
      timeoutMs: 15 * 60 * 1000,
      allowedDomains: ["registry.npmjs.org"],
    });
    try {
      await handle.writeFiles([{ path: "site/index.html", content: PAGE }]);
      await handle.startBackground!({
        cmd: "python3",
        args: [
          "-m",
          "http.server",
          "4173",
          "--bind",
          "127.0.0.1",
          "--directory",
          "site",
        ],
      });
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      const browser = new SandboxBrowser(handle);
      const session = await browser.session({
        url: "http://127.0.0.1:4173/",
        actions: [{ type: "click", selector: "#go" }],
        texts: ["clicked"],
      });
      console.log(
        JSON.stringify({ ...session, html: session.html.length }, null, 2),
      );
      expect(session.error).toBeUndefined();
      expect(session.status).toBe(200);
      expect(session.actions[0]?.ok).toBe(true);
      expect(session.texts[0]?.found).toBe(true);
      expect(session.viewports).toHaveLength(3);
    } finally {
      await handle.stop().catch(() => undefined);
    }
  }, 900_000);
});
