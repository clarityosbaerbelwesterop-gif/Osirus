// The browser program that runs inside the sandbox VM, next to the app it
// inspects. It is a fixed script -- the agent chooses the URL path and a
// short list of typed actions, never code -- and it prints one JSON report.
// Chromium comes from @sparticuz/chromium, built for the Amazon Linux the VM
// runs; OSIRUS_CHROMIUM_PATH points at a local browser in tests.

export const BROWSER_SCRIPT = String.raw`
import { chromium as pw } from "playwright-core";

const input = JSON.parse(Buffer.from(process.argv[2], "base64").toString("utf8"));
let executablePath = process.env.OSIRUS_CHROMIUM_PATH;
let args = ["--no-sandbox"];
if (!executablePath) {
  const sparticuz = (await import("@sparticuz/chromium")).default;
  executablePath = await sparticuz.executablePath();
  args = sparticuz.args;
}
const browser = await pw.launch({ executablePath, args, headless: true });
const report = {
  url: input.url, status: null, title: null, html: "",
  consoleErrors: [], failedRequests: [], actions: [], viewports: [], a11y: {},
  selectors: [], texts: [],
};
const favicon = (url) => /\/favicon\.ico(\?|$)/.test(url);
try {
  const page = await browser.newPage();
  page.on("console", (m) => {
    if (m.type() === "error" && !favicon(m.location().url))
      report.consoleErrors.push(m.text().slice(0, 300));
  });
  page.on("pageerror", (e) => report.consoleErrors.push("pageerror: " + String(e.message).slice(0, 300)));
  page.on("requestfailed", (r) => { if (!favicon(r.url())) report.failedRequests.push(r.method() + " " + r.url().slice(0, 200)); });
  page.on("response", (r) => { if (r.status() >= 400 && !favicon(r.url())) report.failedRequests.push(r.status() + " " + r.url().slice(0, 200)); });
  const response = await page.goto(input.url, { waitUntil: "networkidle", timeout: 20000 });
  report.status = response ? response.status() : null;
  for (const action of (input.actions || []).slice(0, 10)) {
    const entry = { type: action.type, selector: action.selector || null, ok: true, detail: "" };
    try {
      if (action.type === "click") await page.locator(action.selector).first().click({ timeout: 5000 });
      else if (action.type === "fill") await page.locator(action.selector).first().fill(String(action.text || ""), { timeout: 5000 });
      else if (action.type === "press") await page.keyboard.press(String(action.key || "Enter"));
      else if (action.type === "wait") await page.locator(action.selector).first().waitFor({ timeout: 5000 });
      await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => undefined);
    } catch (error) {
      entry.ok = false;
      entry.detail = String(error.message || error).split("\n")[0].slice(0, 200);
    }
    report.actions.push(entry);
  }
  report.title = await page.title();
  report.html = (await page.content()).slice(0, 400000);
  for (const selector of (input.selectors || []).slice(0, 20))
    report.selectors.push({ selector, count: await page.locator(selector).count().catch(() => 0) });
  const text = await page.evaluate(() => document.body ? document.body.innerText : "");
  for (const wanted of (input.texts || []).slice(0, 20))
    report.texts.push({ text: wanted, found: text.toLowerCase().includes(String(wanted).toLowerCase()) });
  report.visibleText = text.slice(0, 4000);
  report.a11y = await page.evaluate(() => ({
    unnamedButtons: [...document.querySelectorAll("button")].filter((b) => !(b.textContent || "").trim() && !b.getAttribute("aria-label") && !b.getAttribute("aria-labelledby")).length,
    imagesWithoutAlt: [...document.querySelectorAll("img")].filter((i) => !i.hasAttribute("alt")).length,
    unlabelledInputs: [...document.querySelectorAll("input:not([type=hidden]), select, textarea")].filter((el) => !el.getAttribute("aria-label") && !el.getAttribute("aria-labelledby") && !(el.id && document.querySelector('label[for="' + el.id + '"]')) && !el.closest("label")).length,
    headings: [...document.querySelectorAll("h1")].length,
  }));
  for (const viewport of input.viewports) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    const shot = await page.screenshot({ fullPage: false, path: input.shotDir + "/" + viewport.name + ".png" });
    report.viewports.push({ name: viewport.name, horizontalOverflow: overflow, screenshotBytes: shot.length });
  }
} catch (error) {
  report.error = String(error.message || error).split("\n")[0].slice(0, 300);
} finally {
  await browser.close();
}
process.stdout.write("OSIRUS_REPORT " + JSON.stringify(report));
`;
