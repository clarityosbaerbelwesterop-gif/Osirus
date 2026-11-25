import { randomBytes, randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";

// The owner's journey against production, as issue #26 defines the merge
// gate: sign in, stay in /app across a reload, "Hallo" gets an answer, an MCP
// server can be added and checked, sign out ends the session. It also starts
// "Continue with GitHub" and records how far that gets without a GitHub
// account. Nothing secret is printed: the password is random per run and
// never logged, cookie values and query strings are never logged, and the
// answer text is not stored -- only that it exists.

const base = process.env.PROD_BASE_URL ?? "https://osirus-ai.com";
const runId = process.env.GITHUB_RUN_ID ?? `${Date.now()}`;
// A re-run keeps the run id; the attempt keeps its account apart from the
// one an earlier attempt may have left behind.
const attempt = process.env.GITHUB_RUN_ATTEMPT ?? "1";
const email = `journey-${runId}-${attempt}@example.com`;
let signedUp = false;
let accountDeleted = false;

/** Live (not deleted) Stripe customers with this e-mail; null without a key. */
async function stripeCustomers(address: string): Promise<number | null> {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  const response = await fetch(
    `https://api.stripe.com/v1/customers?email=${encodeURIComponent(address)}&limit=10`,
    { headers: { authorization: `Bearer ${key}` } },
  );
  if (!response.ok) throw new Error(`stripe_list_${response.status}`);
  const body = (await response.json()) as { data: unknown[] };
  return body.data.length;
}
const password = randomBytes(24).toString("base64url");

const redact = (url: string) => {
  const parsed = new URL(url);
  return `${parsed.host}${parsed.pathname}${parsed.search ? "?…" : ""}`;
};

test.describe.configure({ mode: "serial" });

// A journey that fails midway (an outside MCP server down, a timeout) must
// not leave its account, data and Stripe customer behind in production.
test.afterEach(async ({ page }) => {
  if (!signedUp || accountDeleted) return;
  const response = await page.request
    .fetch("/api/account", {
      method: "DELETE",
      headers: { origin: base, "content-type": "application/json" },
      data: JSON.stringify({ confirm: "LÖSCHEN" }),
    })
    .catch(() => null);
  accountDeleted = response?.status() === 200;
  console.log(
    `Cleanup after failure: account delete ${response ? `HTTP ${response.status()}` : "unreachable"}`,
  );
});

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
    signedUp = true;
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
  let computerBotId: string | null = null;
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

  await test.step("a code block from an answer runs in the sandbox", async () => {
    const started = Date.now();
    const response = await page.request.post("/api/chat/run", {
      headers: { origin: base, "content-type": "application/json" },
      data: { language: "python", code: "print(sum(range(1, 101)))" },
    });
    const body = (await response.json()) as {
      ok?: boolean;
      exitCode?: number | null;
      stdout?: string;
    };
    console.log(
      `Sandbox run in ${Math.round((Date.now() - started) / 1000)} s: exit ${body.exitCode}`,
    );
    expect(response.status()).toBe(200);
    expect(body.exitCode).toBe(0);
    expect(body.stdout?.trim()).toBe("5050");
  });

  await test.step("Code offers a short list of recommended models", async () => {
    const response = await page.request.get("/api/models");
    expect(response.status()).toBe(200);
    const body = (await response.json()) as {
      models: Array<{ id: string; name: string }>;
      featuredIds?: string[];
      defaultId: string | null;
    };
    const ids = new Set(body.models.map((model) => model.id));
    console.log(
      `Models: ${body.models.length} listed, ${body.featuredIds?.length ?? 0} recommended`,
    );
    expect(body.featuredIds?.length ?? 0).toBeGreaterThan(0);
    expect(body.featuredIds!.length).toBeLessThanOrEqual(10);
    expect(body.featuredIds!.every((id) => ids.has(id))).toBe(true);
    if (body.defaultId) expect(ids.has(body.defaultId)).toBe(true);
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

  // Production 2026-11: on the free plan a model with the Free badge (a
  // Haiku) was listed but refused when it ran, and the page could not start
  // again. A picked Free model now runs; the next step runs on another.
  await test.step("a model with the Free badge runs on the free plan", async () => {
    const listed = (await (await send(page, "/api/models")).json()) as {
      models: Array<{ id: string; name: string; free: boolean }>;
      defaultId: string | null;
      freeOnly: boolean;
    };
    const free = listed.models.filter((model) => model.free);
    const pick =
      free.find((model) => /haiku/i.test(model.name)) ??
      free.find((model) => model.id !== listed.defaultId) ??
      free[0];
    console.log(
      `Free plan: ${listed.freeOnly}; ${free.length} Free model(s); picked ${pick?.name ?? "none"}`,
    );
    expect(listed.freeOnly).toBe(true);
    expect(pick).toBeTruthy();
    const started = Date.now();
    // The runtime's own free-plan lock (Code's path; the Rouge Agent is a
    // paid plan's since 2026-11-25, so the "ai" surface carries the run).
    const response = await send(page, "/api/runtime", {
      objective: "Antworte nur mit dem Wort OK.",
      requestId: randomUUID(),
      surface: "ai",
      modelId: pick!.id,
    });
    expect(response.status()).toBe(200);
    const runIdHeader = response.headers()["x-osirus-run-id"];
    const fallback = response.headers()["x-osirus-model-fallback"];
    await response.text();
    let run: { status?: string; errorCode?: string | null } = {};
    for (let tries = 0; tries < 90; tries += 1) {
      run =
        (
          (await (await send(page, `/api/runtime/${runIdHeader}`)).json()) as {
            run?: typeof run;
          }
        ).run ?? {};
      if (["completed", "failed", "cancelled"].includes(run.status ?? ""))
        break;
      await page.waitForTimeout(2_000);
    }
    console.log(
      `Free model run ${run.status} in ${Math.round((Date.now() - started) / 1000)} s${fallback ? ` (fallback: ${fallback})` : ""}${run.errorCode ? `; cause ${run.errorCode}` : ""}`,
    );
    expect(run.errorCode ?? null).not.toBe("model_not_in_plan");
    expect(run.status).toBe("completed");
  });

  // Owner's decision 2026-11-25: the Rouge Agent runs on premium models and
  // is part of the paid plans. A free account gets the plan offer, no run.
  await test.step("the Rouge Agent offers Pro to a free account", async () => {
    const response = await send(page, "/api/runtime", {
      objective: "Hallo",
      requestId: randomUUID(),
      surface: "agent",
    });
    const body = (await response.json()) as {
      error?: string;
      message?: string;
    };
    console.log(
      `Rouge on the free plan: HTTP ${response.status()} ${body.error}`,
    );
    expect(response.status()).toBe(402);
    expect(body.error).toBe("plan_required");
    await page.goto(`${base}/app/agent`);
    await expect(
      page.getByText("Der Rouge Agent ist ab Pro enthalten."),
    ).toBeVisible();
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

  await test.step("a bot runs code on its own cloud computer", async () => {
    const created = await send(page, "/api/agents", {
      name: `Rechner ${runId}`.slice(0, 80),
      systemPrompt: "Du rechnest exakt und nutzt dafür deinen Computer.",
    });
    expect(created.status()).toBe(201);
    const bot = ((await created.json()) as { agent: { id: string } }).agent;
    const started = Date.now();
    const events = await streamFrames({
      message:
        "Rechne mit Python auf deinem Computer 2 hoch 64 aus und nenne nur die Zahl.",
      botId: bot.id,
    });
    const steps = events
      .filter((frame) => frame.type === "computer" && "step" in frame)
      .map(
        (frame) =>
          frame.step as {
            command: string;
            exitCode: number | null;
            output: string;
          },
      );
    const text = events
      .filter((frame) => frame.type === "text")
      .map((frame) => frame.text)
      .join("");
    console.log(
      `Bot computer: ${steps.length} step(s), exit ${steps.map((step) => step.exitCode).join(",")}, ${Math.round((Date.now() - started) / 1000)} s`,
    );
    expect(events.at(-1)?.type).toBe("done");
    expect(steps.length).toBeGreaterThan(0);
    expect(
      steps.some((step) => step.output.includes("18446744073709551616")),
    ).toBe(true);
    expect(text.replace(/[.,\s]/g, "")).toContain("18446744073709551616");
    computerBotId = bot.id;
  });

  await test.step("the bot's computer opens in Open Terminal: shell, files, processes", async () => {
    expect(computerBotId).toBeTruthy();
    const path = `/api/agents/${computerBotId}/computer`;
    const started = Date.now();
    const run = await send(page, path, {
      action: "run",
      // /tmp is outside the kept folder: it marks this very machine.
      command:
        "python3 -c 'print(6 * 7)' && echo open-terminal > ot.txt && touch /tmp/osirus-machine-b",
    });
    const ran = (await run.json()) as {
      ok?: boolean;
      error?: string;
      result?: {
        status?: string;
        exit_code?: number | null;
        output?: Array<{ data: string }>;
      };
    };
    console.log(
      `Open Terminal run: HTTP ${run.status()} ${ran.error ?? ran.result?.status ?? ""} in ${Math.round((Date.now() - started) / 1000)} s`,
    );
    expect(run.status()).toBe(200);
    expect(ran.result?.exit_code).toBe(0);
    expect(
      (ran.result?.output ?? []).map((chunk) => chunk.data).join(""),
    ).toContain("42");
    const files = (await (
      await send(page, path, { action: "files", path: "." })
    ).json()) as { result?: { entries?: Array<{ name: string }> } };
    expect(files.result?.entries?.map((entry) => entry.name)).toContain(
      "ot.txt",
    );
    const processes = await send(page, path, { action: "processes" });
    expect(processes.status()).toBe(200);
    expect(await processes.text()).not.toContain("log_path");
  });

  // Machines are throwaway (no VM snapshot): only the working folder is
  // kept. A chat answer that uses the computer ends by saving the folder and
  // deleting the machine; the next Open Terminal action gets a fresh machine
  // with the folder unpacked, so ot.txt is back and the /tmp mark is not.
  await test.step("the bot's files survive a fresh machine", async () => {
    expect(computerBotId).toBeTruthy();
    const events = await streamFrames({
      message:
        "Lies mit deinem Computer die Datei ot.txt in deinem Arbeitsordner und nenne nur ihren Inhalt.",
      botId: computerBotId!,
    });
    const used = events.filter(
      (frame) => frame.type === "computer" && "step" in frame,
    ).length;
    expect(events.at(-1)?.type).toBe("done");
    const path = `/api/agents/${computerBotId}/computer`;
    const check = await send(page, path, {
      action: "run",
      command:
        "cat ot.txt && if [ -e /tmp/osirus-machine-b ]; then echo same-machine; else echo fresh-machine; fi",
    });
    const checked = (await check.json()) as {
      result?: { exit_code?: number | null; output?: Array<{ data: string }> };
    };
    const output = (checked.result?.output ?? [])
      .map((chunk) => chunk.data)
      .join("");
    console.log(
      `Files across machines: ${used} chat step(s); ${output.replace(/\s+/g, " ").trim()}`,
    );
    expect(check.status()).toBe(200);
    expect(output).toContain("open-terminal");
    expect(output).toContain("fresh-machine");
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

    // A bot proposes one of these tools, the person approves the exact
    // call, and the answer uses its result.
    const servers = (await (await send(page, "/api/mcp/servers")).json()) as {
      servers: Array<{
        id: string;
        tools: Array<{ id: string; name: string }>;
      }>;
    };
    const tools =
      servers.servers.find((server) => server.id === body.id)?.tools ?? [];
    for (const tool of tools) {
      const patched = await page.request.fetch(
        `/api/mcp/servers/${body.id}/tools/${tool.id}`,
        {
          method: "PATCH",
          headers: { origin: base, "content-type": "application/json" },
          data: JSON.stringify({ enabled: true }),
        },
      );
      expect(patched.status()).toBe(200);
    }
    const created = await send(page, "/api/agents", {
      name: `Doku ${runId}`.slice(0, 80),
      systemPrompt:
        "Du beantwortest Fragen zu GitHub-Repositories mit DeepWiki.",
    });
    expect(created.status()).toBe(201);
    const bot = ((await created.json()) as { agent: { id: string } }).agent;

    // Speed with tools connected, for messages that need none: every bot
    // message used to wait for a tool-planning model call first.
    const timed = async (text: string) => {
      const started = Date.now();
      const frames = await streamFrames({ message: text, botId: bot.id });
      expect(frames.at(-1)?.type).toBe("done");
      const tool = frames.some((frame) => frame.type === "tool_request");
      return `${((Date.now() - started) / 1000).toFixed(1)}${tool ? "(tool)" : ""}`;
    };
    const smallTalk = [await timed("Danke dir!"), await timed("Hallo!")];
    const plain = [
      await timed("In einem Satz: Was ist Photosynthese?"),
      await timed("Wie viele Tage hat ein Schaltjahr? Nur die Zahl."),
    ];
    console.log(
      `Bot with tools, no tool needed: small talk ${smallTalk.join(" / ")} s; question ${plain.join(" / ")} s`,
    );

    const message =
      "Nutze DeepWiki und frag: Wofür ist das Repository sindresorhus/ky da? Ein Satz.";
    const planned = await streamFrames({ message, botId: bot.id });
    const request = planned.find((frame) => frame.type === "tool_request") as
      | { messageId: string; request: { label: string; status: string } }
      | undefined;
    console.log(
      `Bot tool step: ${request ? `asked for ${request.request.label}` : "answered without a tool"}`,
    );
    expect(planned.at(-1)?.type).toBe("done");
    if (request) {
      const sessionId = String(planned[0]?.sessionId ?? "");
      const decided = (await (
        await send(page, "/api/chat/tool", {
          sessionId,
          messageId: request.messageId,
          approve: true,
        })
      ).json()) as { request?: { status: string; error?: string | null } };
      console.log(
        `Tool call approved: ${decided.request?.status} ${decided.request?.error ?? ""}`,
      );
      expect(decided.request?.status).toBe("done");
      const answered = await streamFrames({
        sessionId,
        message,
        botId: bot.id,
        regenerate: true,
        toolMessageId: request.messageId,
      });
      const text = answered
        .filter((frame) => frame.type === "text")
        .map((frame) => frame.text)
        .join("");
      expect(answered.at(-1)?.type).toBe("done");
      expect(text.trim().length).toBeGreaterThan(0);
      // Approving twice does not run it twice.
      const again = (await (
        await send(page, "/api/chat/tool", {
          sessionId,
          messageId: request.messageId,
          approve: true,
        })
      ).json()) as { request?: { status: string } };
      expect(again.request?.status).toBe("done");
    }
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

  await test.step("GDPR: the person downloads their data, then deletes the account", async () => {
    const exported = await send(page, "/api/account/export");
    expect(exported.status()).toBe(200);
    expect(exported.headers()["content-disposition"] ?? "").toContain(
      "attachment",
    );
    const copy = (await exported.json()) as {
      format: string;
      data: { profile: Array<{ email: string }>; messages: unknown[] };
    };
    expect(copy.format).toBe("osirus-account-export/1");
    expect(copy.data.profile[0]?.email).toBe(email);
    expect(copy.data.messages.length).toBeGreaterThan(0);
    // Sealed connection tokens are never part of the copy.
    expect(JSON.stringify(copy)).not.toContain("credential_reference");

    // Art. 17: the customer record at Stripe goes with the account. Checked
    // read-only at Stripe itself when the journey has the key.
    const before = await stripeCustomers(email);
    const deleted = await page.request.fetch("/api/account", {
      method: "DELETE",
      headers: { origin: base, "content-type": "application/json" },
      data: JSON.stringify({ confirm: "LÖSCHEN" }),
    });
    console.log(`Account delete: HTTP ${deleted.status()}`);
    expect(deleted.status()).toBe(200);
    accountDeleted = true;
    const after = await stripeCustomers(email);
    if (before !== null && after !== null) {
      console.log(
        `Stripe customers for this e-mail: ${before} before, ${after} after deletion`,
      );
      expect(after).toBe(0);
    } else {
      console.log("Stripe check skipped (no key on this run)");
    }
    await page.goto("/app");
    await expect(page).toHaveURL(/\/auth\/sign-in/);
    // The sign-in itself is gone too.
    await page.locator('input[name="email"]').fill(email);
    await page.locator('input[name="password"]').fill(password);
    await page.getByRole("button", { name: "Anmelden", exact: true }).click();
    await page.waitForTimeout(5_000);
    await expect(page).toHaveURL(/\/auth\/sign-in/);
    console.log("Data exported, account and sign-in deleted");
  });
});
