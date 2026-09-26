import { randomBytes, randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";

// The owner's journey against production, as issue #26 defines the merge
// gate: sign in, stay in /app across a reload, "Hallo" gets an answer, an MCP
// server can be added and checked, sign out ends the session. It also starts
// "Continue with GitHub" and records how far that gets without a GitHub
// account. Nothing secret is printed: the password is random per run and
// never logged, cookie values and query strings are never logged, and the
// answer text is not stored -- only that it exists.

const base = process.env.PROD_BASE_URL ?? "https://osirus.vercel.app";
const runId = process.env.GITHUB_RUN_ID ?? `${Date.now()}`;
const email = `journey-${runId}@example.com`;
const password = randomBytes(24).toString("base64url");

const redact = (url: string) => {
  const parsed = new URL(url);
  return `${parsed.host}${parsed.pathname}${parsed.search ? "?…" : ""}`;
};

test.describe.configure({ mode: "serial" });

test("GitHub sign-in reaches GitHub (no GitHub account used)", async ({
  page,
}) => {
  const hops: string[] = [];
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) hops.push(redact(frame.url()));
  });
  await page.goto("/auth/sign-in");
  await page.getByRole("button", { name: "Continue with GitHub" }).click();
  await page.waitForURL(/github\.com/, { timeout: 30_000 });
  const cookies = (await page.context().cookies(base)).map(
    (cookie) =>
      `${cookie.name} (sameSite=${cookie.sameSite}, secure=${cookie.secure}, httpOnly=${cookie.httpOnly})`,
  );
  console.log(`Redirect chain: ${hops.join(" -> ")}`);
  console.log(`Osirus cookies at GitHub: ${cookies.join("; ") || "none"}`);
  const title = await page.title();
  console.log(`GitHub page: ${redact(page.url())} "${title}"`);
  const body = (await page.locator("body").innerText()).slice(0, 2_000);
  expect(title).not.toMatch(/not found|seite nicht gefunden/i);
  expect(body).not.toMatch(/redirect_uri/i);
  // Either GitHub's login form or its authorize page for the Osirus app.
  expect(page.url()).toMatch(
    /github\.com\/(login|sessions|login\/oauth\/authorize)/,
  );
});

async function send(page: Page, path: string, body?: unknown) {
  return page.request.fetch(path, {
    method: body === undefined ? "GET" : "POST",
    headers: { origin: base, "content-type": "application/json" },
    data: body === undefined ? undefined : JSON.stringify(body),
    timeout: 5 * 60_000,
  });
}

test("email journey: account, session, Hallo, MCP, sign out", async ({
  page,
}) => {
  await test.step("create an account", async () => {
    await page.goto("/auth/sign-up");
    await page.locator('input[name="name"]').fill("Osirus journey check");
    await page.locator('input[name="email"]').fill(email);
    await page.locator('input[name="password"]').fill(password);
    await page.getByRole("button", { name: "Create account" }).click();
    await page.waitForURL(/\/app(\/|$|\?)/, { timeout: 60_000 });
    console.log(`Signed up as ${email} and landed in /app`);
  });

  await test.step("the session survives a reload", async () => {
    await page.reload();
    await expect(page).toHaveURL(/\/app(\/|$|\?)/);
  });

  await test.step('"Hallo" gets an answer', async () => {
    const started = Date.now();
    const response = await send(page, "/api/runtime", {
      objective: "Hallo",
      requestId: randomUUID(),
    });
    expect(response.status()).toBe(200);
    const runIdHeader = response.headers()["x-osirus-run-id"];
    const stream = await response.text();
    const errors = stream
      .split("\n")
      .filter((line) => line.startsWith("data: "))
      .map(
        (line) =>
          JSON.parse(line.slice(6)) as { kind?: string; message?: string },
      )
      .filter((packet) => packet.kind === "error")
      .map((packet) => packet.message);
    if (errors.length) console.log(`Run errors: ${errors.join(" | ")}`);
    const snapshot = (await (
      await send(page, `/api/runtime/${runIdHeader}`)
    ).json()) as {
      run?: { status?: string };
      messages?: Array<{ role: string; content: string }>;
    };
    const answer = (snapshot.messages ?? []).find(
      (message) => message.role === "assistant",
    );
    console.log(
      `Run ${snapshot.run?.status}; answer ${answer?.content?.trim() ? `present (${answer.content.length} chars)` : "missing"}; ${Math.round((Date.now() - started) / 1000)} s`,
    );
    expect(snapshot.run?.status).toBe("completed");
    expect(answer?.content?.trim().length ?? 0).toBeGreaterThan(0);
  });

  await test.step("an MCP server can be added, checked and removed", async () => {
    const added = await send(page, "/api/mcp/servers", {
      name: `DeepWiki ${runId}`,
      url: "https://mcp.deepwiki.com/mcp",
    });
    const body = (await added.json()) as {
      id?: string;
      result?: { ok?: boolean; toolCount?: number; error?: string };
      error?: string;
    };
    console.log(
      `MCP add: HTTP ${added.status()} ok=${body.result?.ok} tools=${body.result?.toolCount ?? 0} ${body.error ?? body.result?.error ?? ""}`,
    );
    expect(added.status()).toBe(200);
    expect(body.result?.ok).toBe(true);
    expect(body.result?.toolCount ?? 0).toBeGreaterThan(0);
    const removed = await page.request.delete(`/api/mcp/servers/${body.id}`, {
      headers: { origin: base },
    });
    expect(removed.status()).toBeLessThan(300);
  });

  await test.step("sign out ends the session", async () => {
    await page.goto("/app/settings");
    await page.getByRole("button", { name: "Sign out" }).click();
    await page.waitForURL(/\/auth\/sign-in/, { timeout: 30_000 });
    await page.goto("/app");
    await expect(page).toHaveURL(/\/auth\/sign-in/);
  });
});
