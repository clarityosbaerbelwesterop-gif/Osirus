import { randomBytes, randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";

// The owner's journey against production, as issue #26 defines the merge
// gate: sign in, stay in /app across a reload, "Hallo" gets an answer, an MCP
// server can be added and checked, sign out ends the session. It also starts
// "Continue with GitHub" and records how far that gets without a GitHub
// account. Nothing secret is printed: the password is random per run and
// never logged, cookie values and query strings are never logged, and the
// answer text is not stored -- only that it exists.

const base = process.env.PROD_BASE_URL ?? "https://osirus-ai.vercel.app";
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
  await page.getByRole("button", { name: "Weiter mit GitHub" }).click();
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

test("cancellation button: from the landing page to the form, without sign-in", async ({
  page,
}) => {
  // Only opens the page; a real declaration is never sent from here.
  await page.goto("/");
  await page.getByRole("link", { name: "Verträge hier kündigen" }).click();
  await page.waitForURL(/\/kuendigen$/);
  await expect(
    page.getByRole("heading", { name: "Verträge hier kündigen" }),
  ).toBeVisible();
  await expect(page.getByLabel("Vor- und Nachname")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Jetzt kündigen" }),
  ).toBeEnabled();
});

async function send(page: Page, path: string, body?: unknown) {
  return page.request.fetch(path, {
    method: body === undefined ? "GET" : "POST",
    headers: { origin: base, "content-type": "application/json" },
    data: body === undefined ? undefined : JSON.stringify(body),
    timeout: 5 * 60_000,
  });
}

test("email journey: account, chat saved, quota, MCP, sign out and in", async ({
  page,
}) => {
  test.setTimeout(10 * 60_000);
  await test.step("create an account", async () => {
    await page.goto("/auth/sign-up");
    await page.locator('input[name="name"]').fill("Journey Prüfung");
    await page.locator('input[name="email"]').fill(email);
    await page.locator('input[name="password"]').fill(password);
    await page.locator("#accept-terms").check();
    await page.locator("#accept-privacy").check();
    await page.getByRole("button", { name: "Konto erstellen" }).click();
    await page.waitForURL(/\/app(\/|$|\?)/, { timeout: 60_000 });
    console.log(`Signed up as ${email} and landed in /app`);
  });

  await test.step("a new account gets the introduction, once", async () => {
    const tour = page.getByRole("dialog");
    await expect(
      tour.getByRole("heading", { name: "Willkommen bei Osirus, Journey" }),
    ).toBeVisible({ timeout: 30_000 });
    await tour.getByRole("button", { name: "Los geht's" }).click();
    for (let step = 2; step < 8; step++)
      await tour.getByRole("button", { name: "Weiter" }).click();
    await expect(tour.getByRole("heading", { name: "Leg los" })).toBeVisible();
    // The server action that records it on the account.
    const recorded = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        Boolean(response.request().headers()["next-action"]),
    );
    await tour.getByRole("button", { name: "Fertig" }).click();
    await expect(tour).toBeHidden();
    expect((await recorded).ok()).toBe(true);
    // Recorded on the account: a reload does not open it again.
    await page.reload();
    await expect(page.locator(".ac-hero-title")).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    console.log("Introduction shown once and recorded");
  });

  await test.step("the greeting and the account use the account's name", async () => {
    await expect(page.locator(".ac-hero-title")).toContainText("Journey");
    await expect(page.locator(".account-text")).toContainText(
      "Journey Prüfung",
    );
    await expect(page.locator("body")).not.toContainText("Alex");
  });

  await test.step("the session survives a reload", async () => {
    await page.reload();
    await expect(page).toHaveURL(/\/app(\/|$|\?)/);
  });

  const question = `Sag in einem Satz Hallo (${runId})`;
  await test.step("Agents answers and the chat is saved", async () => {
    const started = Date.now();
    const input = page.getByRole("textbox", { name: "Nachricht" });
    await input.fill(question);
    await input.press("Enter");
    await expect(page.locator(".ac-answer").last()).not.toBeEmpty({
      timeout: 120_000,
    });
    await expect(page.locator(".ac-actions").last()).toBeVisible({
      timeout: 120_000,
    });
    console.log(
      `Agents answered in ${Math.round((Date.now() - started) / 1000)} s`,
    );
    await expect(page).toHaveURL(/session=/);
    await expect(page.locator(".sidebar")).toContainText(question.slice(0, 30));
  });

  await test.step("the chat is still there after a reload", async () => {
    await page.reload();
    await expect(page.locator(".ac-user").first()).toContainText(question);
    await expect(page.locator(".ac-answer").first()).not.toBeEmpty();
    await expect(page.locator(".sidebar")).toContainText(question.slice(0, 30));
  });

  await test.step("the call is charged against both windows", async () => {
    const quota = (await (await send(page, "/api/billing/quota")).json()) as {
      plan?: string;
      windows?: Array<{ window: string; spentUsd: number; budgetUsd: number }>;
    };
    const five = quota.windows?.find((w) => w.window === "fiveHour");
    const week = quota.windows?.find((w) => w.window === "weekly");
    console.log(
      `Plan ${quota.plan}; 5h ${five?.spentUsd}/${five?.budgetUsd} USD; week ${week?.spentUsd}/${week?.budgetUsd} USD`,
    );
    expect(five?.spentUsd ?? 0).toBeGreaterThan(0);
    expect(week?.spentUsd ?? 0).toBeGreaterThan(0);
  });

  const streamFrames = async (body: unknown) => {
    const response = await send(page, "/api/chat/stream", body);
    expect(response.status()).toBe(200);
    return (await response.text())
      .split("\n\n")
      .filter((chunk) => chunk.startsWith("data: "))
      .map((chunk) => JSON.parse(chunk.slice(6)) as Record<string, unknown>);
  };

  let fileSession = "";
  await test.step("an attached file is read for the answer", async () => {
    const upload = await page.request.post("/api/attachments", {
      headers: { origin: base },
      multipart: {
        file: {
          name: "staedte.csv",
          mimeType: "text/csv",
          buffer: Buffer.from("Stadt,Einwohner\nMoers,104000\n"),
        },
      },
    });
    expect(upload.status()).toBe(201);
    const { attachment } = (await upload.json()) as {
      attachment: { id: string; status: string };
    };
    expect(attachment.status).toBe("parsed");
    const started = Date.now();
    const frames = await streamFrames({
      message: "Wie viele Einwohner hat Moers laut der Datei? Nur die Zahl.",
      attachmentIds: [attachment.id],
    });
    const text = frames
      .filter((f) => f.type === "text")
      .map((f) => f.text)
      .join("");
    console.log(
      `File answer in ${Math.round((Date.now() - started) / 1000)} s: ${/104[.,\s]?000/.test(text) ? "uses the file" : "does not quote the number"}`,
    );
    expect(frames.at(-1)?.type).toBe("done");
    expect(text).toMatch(/104[.,\s]?000/);
    fileSession = String(frames[0]?.sessionId ?? "");
  });

  await test.step("web search answers with numbered sources", async () => {
    const started = Date.now();
    const frames = await streamFrames({
      message: "Wer war Konrad Adenauer? Zwei Sätze.",
      web: true,
    });
    const sources = frames.find((f) => f.type === "sources")?.sources as
      Array<{ url: string }> | undefined;
    console.log(
      `Web answer in ${Math.round((Date.now() - started) / 1000)} s with ${sources?.length ?? 0} source(s)`,
    );
    expect(frames.at(-1)?.type).toBe("done");
    expect(sources?.length ?? 0).toBeGreaterThan(0);
  });

  await test.step("a chat is shared read-only and the link can be ended", async () => {
    expect(fileSession).toMatch(/^[0-9a-f-]{36}$/);
    const shared = (await (
      await send(page, `/api/chat/threads/${fileSession}/share`, {})
    ).json()) as { shared: boolean; url: string };
    expect(shared.shared).toBe(true);
    const path = new URL(shared.url).pathname;
    const view = await page.request.get(path);
    expect(view.status()).toBe(200);
    const html = await view.text();
    expect(html).toContain("Wie viele Einwohner hat Moers");
    // Questions and answers only: no file contents, models or services.
    expect(html).not.toMatch(/openrouter|unorouter|bytez|nvidia:/i);
    await page.request.delete(`/api/chat/threads/${fileSession}/share`, {
      headers: { origin: base },
    });
    expect((await page.request.get(path)).status()).toBe(404);
    console.log("Share link created, read and ended");
  });

  await test.step("no service names reach the browser", async () => {
    const models = await (await send(page, "/api/models")).text();
    // Service names and internal references, not model names (a model may
    // be called "... Lightning").
    expect(models).not.toMatch(
      /openrouter|unorouter|bytez|lightning ai|"provider|"ref"|nvidia:|openrouter:/i,
    );
  });

  await test.step('the Rouge Agent answers "Hallo"', async () => {
    const started = Date.now();
    const response = await send(page, "/api/runtime", {
      objective: "Hallo",
      requestId: randomUUID(),
      surface: "agent",
    });
    expect(response.status()).toBe(200);
    const runIdHeader = response.headers()["x-osirus-run-id"];
    await response.text();
    type Snapshot = {
      run?: {
        status?: string;
        errorCode?: string | null;
        errorMessage?: string | null;
      };
      messages?: Array<{ role: string; content: string }>;
    };
    const terminal = new Set(["completed", "failed", "cancelled", "blocked"]);
    let snapshot: Snapshot = {};
    for (let tries = 0; tries < 90; tries += 1) {
      snapshot = (await (
        await send(page, `/api/runtime/${runIdHeader}`)
      ).json()) as Snapshot;
      if (terminal.has(snapshot.run?.status ?? "")) break;
      await page.waitForTimeout(2_000);
    }
    const answers = (snapshot.messages ?? []).filter(
      (message) => message.role === "assistant",
    );
    console.log(
      `Rouge run ${snapshot.run?.status}; ${answers.length} answer(s); ${Math.round((Date.now() - started) / 1000)} s`,
    );
    // The cause, when it did not finish (the public code and message).
    if (snapshot.run?.status !== "completed")
      console.log(
        `Rouge cause: ${snapshot.run?.errorCode ?? "none"}: ${snapshot.run?.errorMessage ?? ""}`,
      );
    expect(snapshot.run?.status).toBe("completed");
    expect(answers[0]?.content?.trim().length ?? 0).toBeGreaterThan(0);
  });

  // Scheduled runs skip it: every checkout creates a live Stripe customer.
  await test.step("Stripe Checkout opens for a paid plan", async () => {
    if (process.env.JOURNEY_CHECKOUT === "false") {
      console.log("Checkout skipped on this run");
      return;
    }
    const response = await send(page, "/api/billing/checkout", {
      plan: "pro",
    });
    const body = (await response.json()) as {
      url?: string;
      error?: string;
      trialDays?: number | null;
    };
    console.log(
      `Checkout: HTTP ${response.status()} ${body.url ? new URL(body.url).host : (body.error ?? "")}; trial ${body.trialDays ?? 0} days`,
    );
    expect(response.status()).toBe(200);
    expect(body.url ?? "").toMatch(/^https:\/\/checkout\.stripe\.com\//);
    // A new account's first Pro subscription starts with the promised trial.
    expect(body.trialDays).toBe(7);
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
    await page.getByRole("button", { name: "Abmelden" }).click();
    await page.waitForURL(/\/auth\/sign-in/, { timeout: 30_000 });
    await page.goto("/app");
    await expect(page).toHaveURL(/\/auth\/sign-in/);
  });

  await test.step("signing in again shows the saved chat", async () => {
    await page.goto("/auth/sign-in");
    await page.locator('input[name="email"]').fill(email);
    await page.locator('input[name="password"]').fill(password);
    await page.getByRole("button", { name: "Anmelden", exact: true }).click();
    await page.waitForURL(/\/app(\/|$|\?)/, { timeout: 60_000 });
    await expect(page.locator(".sidebar")).toContainText(question.slice(0, 30));
  });
});
