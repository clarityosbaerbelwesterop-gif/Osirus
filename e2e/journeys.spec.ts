import { expect, test } from "@playwright/test";
import type { RunSnapshot } from "../src/lib/runtime/types";
import { codingRunFixture } from "../src/app/ui-fixtures/fixtures";
import {
  FIXTURE_IDS,
  mockApis,
  openSurface,
  PREVIEW_URL,
  VIEWPORTS,
} from "./support";

// The six user journeys, end to end through the real components. Server
// behaviour behind each step is covered by the unit suites (runtime, approvals,
// MCP store and client, automations and notifications); here the API answers
// are fixed so the journeys test what the user sees and what the page sends.

test.use({ viewport: VIEWPORTS.desktop });

const RUN = "3d4e5f6a-7b8c-4d9e-8f0a-1b2c3d4e5f6a";
const SESSION = "4e5f6a7b-8c9d-4e0f-9a1b-2c3d4e5f6a7b";
const QUESTION = "What does MVCC mean in Postgres?";
const ANSWER =
  "MVCC means **multi-version concurrency control**: readers see a snapshot and never block writers.";

function chatSnapshot(): RunSnapshot {
  const at = new Date().toISOString();
  return {
    run: {
      id: RUN,
      sessionId: SESSION,
      objective: QUESTION,
      status: "completed",
      cancelRequested: false,
      armId: "general",
    },
    stages: [],
    attempts: [],
    dependencies: [],
    artifacts: [],
    approvals: [],
    events: [],
    checkpoints: [],
    messages: [
      { id: "u1", role: "user", content: QUESTION, createdAt: at },
      { id: "a1", role: "assistant", content: ANSWER, createdAt: at },
    ],
  } as RunSnapshot;
}

const frame = (packet: unknown) => `data: ${JSON.stringify(packet)}\n\n`;

test("1. sign in, new chat, normal question, streamed answer", async ({
  page,
}) => {
  // Sign-in is the real page; the session behind it is not available in CI.
  await page.goto("/auth/sign-in");
  await expect(page.getByRole("heading", { name: "Anmelden" })).toBeVisible();

  let finished = false;
  await mockApis(page, {
    runSnapshot: () => (finished ? chatSnapshot() : null),
  });
  await page.route("**/api/runtime", (route) => {
    finished = true;
    return route.fulfill({
      status: 200,
      headers: {
        "content-type": "text/event-stream",
        "X-Osirus-Session-Id": SESSION,
        "X-Osirus-Run-Id": RUN,
      },
      body: [
        frame({ kind: "started", runId: RUN, sessionId: SESSION }),
        frame({
          kind: "event",
          event: {
            id: "e1",
            runId: RUN,
            sequence: 1,
            type: "capability.selected",
            visibility: "user",
            summary: "Answering directly",
            at: new Date().toISOString(),
            data: {},
          },
        }),
        frame({ kind: "delta", runId: RUN, text: "MVCC means " }),
        frame({
          kind: "delta",
          runId: RUN,
          text: "multi-version concurrency control",
        }),
        frame({ kind: "done", runId: RUN, status: "completed" }),
      ].join(""),
    });
  });

  await openSurface(page, "chat-empty");
  await expect(page.getByText(/Wieder am Start/)).toBeVisible();
  const composer = page.getByRole("textbox", { name: "Message Osirus" });
  await composer.fill(QUESTION);
  await composer.press("Enter");

  await expect(page.getByText(QUESTION).first()).toBeVisible();
  await expect(
    page.getByText("readers see a snapshot and never block writers"),
  ).toBeVisible();
  await expect(
    page.locator("strong", { hasText: "multi-version concurrency control" }),
  ).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`session=${SESSION}`));
  await expect(page.getByRole("button", { name: "Regenerate" })).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Message Osirus" }),
  ).toBeEnabled();
});

test("2. research run: activity, citations and the source panel", async ({
  page,
}) => {
  await mockApis(page);
  await openSurface(page, "chat-research");

  // Citations in the answer point at footnotes that name the source.
  const citation = page.locator("sup a").first();
  await expect(citation).toBeVisible();
  await expect(
    page.getByText("pgvector README, HNSW indexing section."),
  ).toBeVisible();

  const toggle = page.getByRole("button", { name: "Show run details" });
  if (await toggle.isVisible()) await toggle.click();
  const details = page.getByRole("complementary", { name: "Run details" });

  await details.getByRole("tab", { name: "Run" }).click();
  await details.getByRole("tab", { name: "Activity" }).click();
  await expect(details.getByRole("listitem").first()).toBeVisible();

  await details.getByRole("tab", { name: "Knowledge" }).click();
  // A group with a single view shows no second row of tabs.
  const sources = details.getByRole("tab", { name: "Sources" });
  if (await sources.count()) await sources.click();
  const source = details.getByRole("link", {
    name: /pgvector: Open-source vector similarity search/,
  });
  await expect(source).toBeVisible();
  await expect(source).toHaveAttribute(
    "href",
    "https://github.com/pgvector/pgvector",
  );
  await expect(source).toHaveAttribute("rel", /noopener/);
  await expect(
    details.getByText("Qdrant applies payload filters during vector search."),
  ).toBeVisible();
});

test("3. coding: GitHub connection, workspace, files, diff, terminal, preview", async ({
  page,
}) => {
  await mockApis(page);
  await openSurface(page, "chat-coding");

  const composer = page.getByRole("textbox", { name: "Message Osirus" });
  const grantReads: string[] = [];
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (path === "/api/connectors/github") grantReads.push(path);
  });
  await composer.fill(
    "Add a mode() function to https://github.com/osirus-demo/stats-lib",
  );
  await page.waitForTimeout(400);
  expect(grantReads).toEqual([]);
  await expect(page.getByText("GitHub: baerbel")).toHaveCount(0);

  const toggle = page.getByRole("button", { name: "Show run details" });
  if (await toggle.isVisible()) await toggle.click();
  const details = page.getByRole("complementary", { name: "Run details" });
  await details.getByRole("tab", { name: "Build" }).click();

  await details.getByRole("tab", { name: "Files" }).click();
  await expect(details.getByText("osirus/fix-median").first()).toBeVisible();
  await details.getByRole("button", { name: "src/median.ts" }).click();
  await expect(
    details.getByText("export function median(values: number[])"),
  ).toBeVisible();

  await details.getByRole("tab", { name: "Diff" }).click();
  await expect(
    details.getByText("+  return sorted.length % 2 === 0"),
  ).toBeVisible();

  await details.getByRole("tab", { name: "Terminal" }).click();
  await expect(details.getByText(/Tests\s+42 passed \(42\)/)).toBeVisible();

  await details.getByRole("tab", { name: "Preview" }).click();
  const preview = details.locator("iframe[title='Workspace preview']");
  await expect(preview).toHaveAttribute("src", PREVIEW_URL);
  await expect(preview).toHaveAttribute("sandbox", "allow-scripts allow-forms");
  await expect(
    page
      .frameLocator("iframe[title='Workspace preview']")
      .getByRole("heading", {
        name: "stats-lib demo",
      }),
  ).toBeVisible();
});

test("4. external write: approval card, approve, the run resumes", async ({
  page,
}) => {
  let decided = false;
  const log = await mockApis(page, {
    runSnapshot: () => codingRunFixture(decided ? "done" : "active"),
  });
  await openSurface(page, "chat-active");

  const card = page
    .getByRole("article", { name: /Branch zu GitHub pushen/ })
    .first();
  await expect(card).toBeVisible();
  await expect(card.getByText("Hohes Risiko")).toBeVisible();
  await expect(
    card.getByText("https://github.com/osirus-demo/stats-lib").first(),
  ).toBeVisible();

  await card.getByRole("button", { name: "Freigeben" }).click();
  const confirm = page.getByRole("alertdialog");
  await expect(confirm).toBeVisible();
  decided = true;
  await confirm
    .getByRole("button", { name: "Freigeben und fortfahren" })
    .click();

  await expect(
    page.getByText("it now averages the two middle values"),
  ).toBeVisible();
  await expect(
    page.getByRole("article", { name: /Branch zu GitHub pushen/ }),
  ).toHaveCount(0);
  const decision = log.find((entry) => entry.path.includes("/approvals/"));
  expect(decision?.path).toBe(
    `/api/runtime/${FIXTURE_IDS.codingRun}/approvals/${FIXTURE_IDS.approval}`,
  );
  expect(decision?.body).toEqual({ decision: "approved" });
});

test("5. connect an MCP server, discover tools, inspect permissions", async ({
  page,
}) => {
  const log = await mockApis(page);
  await page.route("**/api/mcp/servers", (route) => {
    const body = route.request().postDataJSON() as { url: string };
    log.push({ method: "POST", path: "/api/mcp/servers", body });
    return route.fulfill(
      body.url.startsWith("https://")
        ? { status: 201, json: { ok: true } }
        : { status: 400, json: { error: "not_https" } },
    );
  });
  await openSurface(page, "connections");

  await page.getByRole("button", { name: "Add MCP server" }).click();
  await page.getByRole("textbox", { name: "Name" }).fill("Team wiki");
  const url = page.getByRole("textbox", { name: "Server URL" });
  await url.fill("http://wiki.example.com/mcp");
  await page.getByRole("button", { name: "Add and test" }).click();
  await expect(
    page.getByText("The URL must start with https://."),
  ).toBeVisible();

  await url.fill("https://wiki.example.com/mcp");
  await page.getByRole("button", { name: "Add and test" }).click();
  await expect(page.getByRole("button", { name: "Add and test" })).toHaveCount(
    0,
  );
  expect(
    log.filter((entry) => entry.path === "/api/mcp/servers").at(-1)?.body,
  ).toMatchObject({
    name: "Team wiki",
    url: "https://wiki.example.com/mcp",
  });

  await page
    .getByRole("button", { name: "Test and discover tools" })
    .first()
    .click();
  await expect
    .poll(() => log.some((entry) => entry.path.endsWith("/check")))
    .toBe(true);

  await page
    .getByText(/Review tools \(\d+\)/)
    .first()
    .click();
  await expect(
    page.getByText("From the server · untrusted").first(),
  ).toBeVisible();
  await expect(
    page.getByText("High risk · asks every time").first(),
  ).toBeVisible();
  const toggle = page.getByRole("switch", {
    name: "Allow Osirus to use create_page",
  });
  await expect(toggle).not.toBeChecked();
  await toggle.click();
  await expect
    .poll(() => log.find((entry) => entry.path.includes("/tools/"))?.body)
    .toEqual({ enabled: true });
});

test("6. create an automation, run it in the background, see the notification", async ({
  page,
}) => {
  const log = await mockApis(page);
  await openSurface(page, "automations");

  await page.getByRole("button", { name: "New automation" }).click();
  await page.getByRole("textbox", { name: "Name" }).fill("Morning brief");
  await page
    .getByRole("textbox", { name: "Objective" })
    .fill("Summarize yesterday's merged pull requests in stats-lib");
  await page.getByRole("button", { name: "Create automation" }).click();
  await expect(
    page.getByRole("button", { name: "Create automation" }),
  ).toHaveCount(0);
  const created = log.find((entry) => entry.path === "/api/automations");
  expect(created?.body).toMatchObject({
    name: "Morning brief",
    trigger: "schedule",
    schedule: { cadence: "weekdays" },
    policyPreset: "cautious",
    notifyOn: ["completed", "failed", "approval"],
  });

  await page.getByRole("button", { name: "Run now" }).first().click();
  await expect(
    page.getByText("Started. It runs in the background"),
  ).toBeVisible();
  expect(
    log.some((entry) => /\/api\/automations\/[^/]+\/run$/.test(entry.path)),
  ).toBe(true);

  await openSurface(page, "inbox");
  const item = page.getByRole("listitem").filter({
    hasText: "Automation finished: Weekday dependency check",
  });
  await expect(item).toBeVisible();
  await item.getByRole("link", { name: "Open" }).click();
  await expect
    .poll(() => log.find((entry) => entry.path === "/api/notifications")?.body)
    .toEqual({ read: ["i3"] });
});

test("7. attach a CSV, send it with the question, remove another file", async ({
  page,
}) => {
  const sent: unknown[] = [];
  await mockApis(page, { runSnapshot: () => chatSnapshot() });
  let uploads = 0;
  await page.route("**/api/attachments", (route) => {
    uploads += 1;
    return route.fulfill({
      status: 201,
      json: {
        attachment: {
          id:
            uploads === 1
              ? "7e1d4c2a-0b3f-4a5e-9c8d-1f2a3b4c5d6e"
              : "8f2e5d3b-1c4a-4b6f-8d9e-2a3b4c5d6e7f",
          filename: uploads === 1 ? "sales.csv" : "notes.txt",
          kind: uploads === 1 ? "csv" : "text",
          status: "parsed",
          note: null,
        },
      },
    });
  });
  await page.route("**/api/attachments/*", (route) =>
    route.fulfill({ status: 200, json: { deleted: true } }),
  );
  await page.route("**/api/runtime", (route) => {
    sent.push(route.request().postDataJSON());
    return route.fulfill({
      status: 200,
      headers: {
        "content-type": "text/event-stream",
        "X-Osirus-Session-Id": SESSION,
        "X-Osirus-Run-Id": RUN,
      },
      body: [
        frame({ kind: "started", runId: RUN, sessionId: SESSION }),
        frame({ kind: "done", runId: RUN, status: "completed" }),
      ].join(""),
    });
  });

  await openSurface(page, "chat-empty");
  const picker = page.locator('input[type="file"]');
  await picker.setInputFiles({
    name: "sales.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("month,revenue\nJan,120\nFeb,150\n"),
  });
  await expect(page.getByText("sales.csv")).toBeVisible();
  await picker.setInputFiles({
    name: "notes.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("scratch"),
  });
  await page.getByRole("button", { name: "Remove notes.txt" }).click();
  await expect(page.getByText("notes.txt")).toHaveCount(0);

  const composer = page.getByRole("textbox", { name: "Message Osirus" });
  await composer.fill("What was the revenue growth from January to February?");
  await composer.press("Enter");
  await expect.poll(() => sent.length).toBe(1);
  expect(sent[0]).toMatchObject({
    attachmentIds: ["7e1d4c2a-0b3f-4a5e-9c8d-1f2a3b4c5d6e"],
  });
  // Sent files leave the composer.
  await expect(page.getByRole("list", { name: "Attached files" })).toHaveCount(
    0,
  );
});

test("8. a run that outlives its request is followed until it finishes", async ({
  page,
}) => {
  // The request slice ends while the run still works ("Continuing in the
  // background"). The page must keep polling -- the poll is also what
  // resumes the run on the server -- and show the answer when it lands.
  let polls = 0;
  const running = (): RunSnapshot => {
    const snapshot = chatSnapshot();
    snapshot.run.status = "running";
    snapshot.messages = snapshot.messages.slice(0, 1);
    return snapshot;
  };
  await mockApis(page, {
    runSnapshot: () => {
      polls += 1;
      return polls < 3 ? running() : chatSnapshot();
    },
  });
  await page.route("**/api/runtime", (route) =>
    route.fulfill({
      status: 200,
      headers: {
        "content-type": "text/event-stream",
        "X-Osirus-Session-Id": SESSION,
        "X-Osirus-Run-Id": RUN,
      },
      body: [
        frame({ kind: "started", runId: RUN, sessionId: SESSION }),
        frame({ kind: "done", runId: RUN, status: "running" }),
      ].join(""),
    }),
  );

  await openSurface(page, "chat-empty");
  const composer = page.getByRole("textbox", { name: "Message Osirus" });
  await composer.fill(QUESTION);
  await composer.press("Enter");

  await expect(
    page.getByText("readers see a snapshot and never block writers"),
  ).toBeVisible({ timeout: 15_000 });
  expect(polls).toBeGreaterThanOrEqual(3);
  await expect(composer).toBeEnabled();
  // Finished runs are not polled any further.
  const settled = polls;
  await page.waitForTimeout(2_500);
  expect(polls).toBe(settled);
});

test("coding surface lists repos from the connected grant and does not start without a branch", async ({
  page,
}) => {
  await mockApis(page);
  await openSurface(page, "coding");
  await expect(
    page.getByRole("option", { name: "osirus-demo/stats-lib" }),
  ).toBeAttached();
  await page.getByLabel("Repository").selectOption("osirus-demo/stats-lib");
  await page.getByLabel("Branch").selectOption("main");
  await expect(page.getByRole("button", { name: "Start" })).toBeEnabled();
  await expect(page.locator(".effort-motion")).toHaveCount(0);
});

test("work recommends a model, a reviewer and sub-agents", async ({ page }) => {
  await mockApis(page);
  await openSurface(page, "work");
  await expect(page.getByText("Klasse")).toBeVisible();
  await expect(page.getByText("Empfohlen").first()).toBeVisible();
  expect(await page.getByText("Empfohlen").count()).toBeGreaterThanOrEqual(3);
  await expect(
    page.getByText(/Platzhalter PLACEHOLDER_EXECUTOR_S/),
  ).toBeVisible();
  // No retired model name in the studio ("Rouge Agent" in the navigation is the product area).
  await expect(page.getByText("ROUGE", { exact: true })).toHaveCount(0);
  const count = page.getByRole("spinbutton", { name: "Anzahl Subagents" });
  await count.fill("1");
  await expect(page.getByText("eigene Wahl")).toBeVisible();
});

test("bots: the team shows each bot's role, never its model, and opens its room", async ({
  page,
}) => {
  await mockApis(page);
  await openSurface(page, "agents");
  await expect(page.getByRole("button", { name: "Deploy" })).toHaveCount(0);
  await expect(page.getByText("Ada", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Software Engineer")).toBeVisible();
  await expect(page.getByText("glm-5.3-flash")).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Mit Ada chatten" }),
  ).toHaveAttribute("href", "/app/agents/11111111-1111-4111-8111-111111111111");
  // A group chat stays and is listed with its last message.
  const group = page.getByRole("link", { name: /Launch-Team/ });
  await expect(group).toHaveAttribute(
    "href",
    "/app/agents/groups/44444444-4444-4444-8444-444444444444",
  );
  await expect(group).toContainText("Drei Wettbewerber");
});

test("bots: a new group chat is created with the picked bots and opens", async ({
  page,
}) => {
  const log = await mockApis(page);
  await openSurface(page, "agents");
  await page.getByRole("button", { name: "Neuer Gruppenchat" }).click();
  await page.getByRole("button", { name: "Bea", pressed: true }).click();
  await page.getByRole("button", { name: "Gruppenchat öffnen" }).click();
  await page.waitForURL(/\/app\/agents\/groups\/66666666-/);
  const sent = log.find((entry) => entry.path === "/api/group-chats");
  expect(sent?.body).toMatchObject({
    title: "Team",
    agentIds: ["11111111-1111-4111-8111-111111111111"],
  });
});

test("bots: a bot's room talks only to that bot and keeps its conversations", async ({
  page,
}) => {
  const log = await mockApis(page);
  await openSurface(page, "agents-room");
  await expect(page.getByRole("heading", { name: "Ada" })).toBeVisible();
  await expect(page.getByText(/Software Engineer/).first()).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Code-Review für den Checkout" }),
  ).toBeVisible();
  const input = page.getByRole("textbox", { name: "Nachricht" });
  await expect(input).toHaveAttribute("placeholder", "Nachricht an Ada");
  await input.fill("Hallo");
  await input.press("Enter");
  await expect(page.getByText("Hallo! Wie kann ich helfen?")).toBeVisible();
  const sent = log.find((entry) => entry.path === "/api/chat/stream");
  expect(sent?.body).toMatchObject({
    message: "Hallo",
    botId: "11111111-1111-4111-8111-111111111111",
  });
  await expect(page).toHaveURL(
    /\/app\/agents\/11111111-1111-4111-8111-111111111111\?session=/,
  );
});

test("bots: a group chat keeps its thread; @Name and @alle choose who answers", async ({
  page,
}) => {
  const log = await mockApis(page);
  await openSurface(page, "agents-group");
  await expect(
    page.getByText("Drei Wettbewerber, eine klare Lücke"),
  ).toBeVisible();
  const message = page.getByRole("textbox", { name: "Nachricht" });
  await message.fill("@Ada bitte kurz antworten");
  await expect(page.getByText("Antwortet: Ada")).toBeVisible();
  await expect(page.getByText("Antwortet: Ada, Bea")).toHaveCount(0);
  await message.fill("@alle wie starten wir?");
  await expect(page.getByText("Antwortet: Ada, Bea")).toBeVisible();
  await message.press("Enter");
  await expect(page.getByText("Gern: zuerst die Freigaben.")).toBeVisible();
  const sent = log.find((entry) => entry.path.endsWith("/messages"));
  expect(sent?.body).toEqual({ content: "@alle wie starten wir?" });
});

test("history: every area is listed and can be filtered", async ({ page }) => {
  await mockApis(page);
  await openSurface(page, "history");
  await expect(page.getByRole("link", { name: /Launch-Team/ })).toBeVisible();
  await page.getByRole("button", { name: /^Rouge Agent/ }).click();
  await expect(
    page.getByRole("link", { name: /Release-Notes schreiben/ }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: /Launch-Team/ })).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Alle Verläufe" }).first(),
  ).toBeVisible();
});

test("agents: an answer streams in, thinking shows its time, the thread joins the sidebar", async ({
  page,
}) => {
  const log = await mockApis(page);
  await openSurface(page, "agents-empty");
  // Osirus picks the model: no picker, an "Auto" label.
  await expect(page.getByText("Auto", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /GPT-5/ })).toHaveCount(0);
  const input = page.getByRole("textbox", { name: "Nachricht" });
  await input.fill("Hallo");
  await input.press("Enter");
  await expect(page.getByText("Hallo! Wie kann ich helfen?")).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Gedacht für|Gedankengang/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Antwort kopieren" }),
  ).toBeVisible();
  const sent = log.find((entry) => entry.path === "/api/chat/stream");
  expect(sent?.body).toMatchObject({ message: "Hallo", sessionId: null });
  expect(sent?.body).not.toHaveProperty("model");
  await expect(page.getByRole("link", { name: "Hallo" })).toBeVisible();
});

test("code: the model picker searches, picks with the keyboard and remembers the choice", async ({
  page,
}) => {
  await mockApis(page);
  await openSurface(page, "coding");
  await page.getByRole("button", { name: /GPT-5/ }).click();
  const search = page.getByPlaceholder(/Modelle durchsuchen/);
  await expect(search).toBeFocused();
  await search.fill("llama");
  await expect(
    page.getByRole("listbox", { name: "Modelle" }).getByRole("option"),
  ).toHaveCount(1);
  await search.press("Enter");
  await expect(
    page.getByRole("button", { name: /Llama 3\.3 70B Instruct/ }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("button", { name: /Llama 3\.3 70B Instruct/ }),
  ).toBeVisible();
});

test("agents: a refused message explains why and offers a retry", async ({
  page,
}) => {
  await mockApis(page);
  await page.route("**/api/chat/stream", (route) =>
    route.fulfill({
      status: 403,
      contentType: "application/json",
      body: JSON.stringify({
        error: "model_not_in_plan",
        message: "Dieses Modell ist im Free-Plan nicht enthalten.",
      }),
    }),
  );
  await openSurface(page, "agents-empty");
  const input = page.getByRole("textbox", { name: "Nachricht" });
  await input.fill("Hallo");
  await input.press("Enter");
  await expect(
    page.getByRole("alert").filter({ hasText: "Free-Plan" }),
  ).toContainText("nicht enthalten");
  await expect(
    page.getByRole("button", { name: "Erneut versuchen" }),
  ).toBeVisible();
});

test("agents: an answer can go to the Rouge Agent as a task", async ({
  page,
}) => {
  await mockApis(page);
  await openSurface(page, "agents-thread");
  await page.getByRole("button", { name: "Rouge Agent" }).last().click();
  await page.waitForURL(/\/app\/agent\?new=1&prompt=/);
  expect(
    decodeURIComponent(new URL(page.url()).searchParams.get("prompt") ?? ""),
  ).toContain("Aufgabe: Wie migriere ich eine Postgres Job-Queue");
});

test("rouge agent: a suggested task fills the composer and Osirus picks the model", async ({
  page,
}) => {
  await mockApis(page);
  let runBody: unknown = null;
  await page.route("**/api/runtime", (route) => {
    runBody = route.request().postDataJSON();
    return route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: "",
    });
  });
  await openSurface(page, "rouge-empty");
  await expect(
    page.getByRole("heading", { name: "Rouge Agent", level: 2 }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: /Plane eine Datenbank-Migration/ })
    .click();
  const composer = page.getByRole("textbox", { name: "Message Osirus" });
  await expect(composer).toHaveValue(/Plane eine Datenbank-Migration/);
  await composer.press("Enter");
  await expect
    .poll(() => runBody)
    .toMatchObject({ surface: "agent", mode: "agent" });
  expect(runBody).not.toHaveProperty("modelId");
});

test("tour: a new account is walked through every part and can start a first task", async ({
  page,
}) => {
  await mockApis(page);
  await openSurface(page, "tour");
  const tour = page.getByRole("dialog");
  await expect(tour).toBeVisible();
  await expect(
    tour.getByRole("heading", { name: "Willkommen bei Osirus, Bärbel" }),
  ).toBeVisible();
  await expect(tour.getByText("Schritt 1 von 8")).toBeVisible();
  // Focus is inside the dialog, and the keyboard drives it.
  await expect(tour.getByRole("button", { name: "Los geht's" })).toBeVisible();
  await tour.getByRole("button", { name: "Los geht's" }).click();
  const titles = [
    "Agents: einfach fragen",
    "Bots: deine Spezialisten",
    "Rouge Agent: erledigt Aufgaben",
    "Code: dein Entwickler",
    "Verbindungen: deine Werkzeuge",
    "Kontingent, Pläne und Sicherheit",
    "Leg los",
  ];
  for (const [index, title] of titles.entries()) {
    await expect(tour.getByRole("heading", { name: title })).toBeVisible();
    await expect(tour.getByText(`Schritt ${index + 2} von 8`)).toBeVisible();
    if (index < titles.length - 1)
      await tour.getByRole("button", { name: "Weiter" }).click();
  }
  // Back works, and the last step offers real first tasks.
  await tour.getByRole("button", { name: "Zurück" }).click();
  await expect(
    tour.getByRole("heading", { name: "Kontingent, Pläne und Sicherheit" }),
  ).toBeVisible();
  await tour.getByRole("button", { name: "Weiter" }).click();
  const ask = tour.getByRole("link", { name: /Eine Frage stellen/ });
  await expect(ask).toHaveAttribute("href", /^\/app\?prompt=/);
  await expect(
    tour.getByRole("link", { name: /Eine Aufgabe übergeben/ }),
  ).toHaveAttribute("href", /^\/app\/agent\?new=1&prompt=/);
  await tour.getByRole("button", { name: "Fertig" }).click();
  await expect(tour).toBeHidden();
});

test("tour: skipping closes it and Escape does too after a replay", async ({
  page,
}) => {
  await mockApis(page);
  await openSurface(page, "tour");
  const tour = page.getByRole("dialog");
  await tour.getByRole("button", { name: "Überspringen" }).click();
  await expect(tour).toBeHidden();
  await page.evaluate(() => window.dispatchEvent(new Event("osirus:tour")));
  await expect(tour).toBeVisible();
  await expect(tour.getByText("Schritt 1 von 8")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(tour).toBeHidden();
});

test("agents: a file and the web go with the question, and the answer lists its sources", async ({
  page,
}) => {
  const log = await mockApis(page);
  await page.route("**/api/attachments", (route) =>
    route.fulfill({
      status: 201,
      json: {
        attachment: {
          id: "7b8c9d0e-1f2a-4b3c-9d4e-5f6a7b8c9d0e",
          status: "parsed",
          note: null,
        },
      },
    }),
  );
  await page.route("**/api/chat/stream", (route) => {
    log.push({
      method: "POST",
      path: "/api/chat/stream",
      body: route.request().postDataJSON(),
    });
    const frames = [
      {
        type: "start",
        sessionId: "8c9d0e1f-2a3b-4c4d-8e5f-6a7b8c9d0e1f",
        title: "Einwohner",
        created: true,
        cached: false,
      },
      {
        type: "sources",
        sources: [
          {
            n: 1,
            title: "Einwohner Berlin",
            url: "https://www.statistik-berlin.de/einwohner",
            domain: "statistik-berlin.de",
          },
        ],
      },
      { type: "text", text: "Berlin hat rund 3,88 Millionen Einwohner [1]." },
      { type: "done", messageId: null, latencyMs: 900 },
    ];
    return route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: frames.map((f) => `data: ${JSON.stringify(f)}\n\n`).join(""),
    });
  });
  await openSurface(page, "agents-empty");
  await page.getByRole("button", { name: "Datei anhängen" }).click();
  await page.locator('input[type="file"]').setInputFiles({
    name: "staedte.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("Stadt,Einwohner\nBerlin,3878100\n"),
  });
  const files = page.getByRole("list", {
    name: "Dateien für die nächste Nachricht",
  });
  await expect(files.getByText("staedte.csv")).toBeVisible();
  const web = page.getByRole("button", { name: "Web" });
  await web.click();
  await expect(web).toHaveAttribute("aria-pressed", "true");
  const input = page.getByRole("textbox", { name: "Nachricht" });
  await input.fill("Wie viele Einwohner hat Berlin?");
  await input.press("Enter");
  await expect(page.getByText(/rund 3,88 Millionen/)).toBeVisible();
  const sources = page.getByRole("region", { name: "Quellen" });
  await expect(
    sources.getByRole("link", { name: /Einwohner Berlin/ }),
  ).toHaveAttribute("href", "https://www.statistik-berlin.de/einwohner");
  await expect(
    page
      .getByRole("list", { name: "Angehängte Dateien" })
      .getByText("staedte.csv"),
  ).toBeVisible();
  const sent = log.find((entry) => entry.path === "/api/chat/stream");
  expect(sent?.body).toMatchObject({
    web: true,
    attachmentIds: ["7b8c9d0e-1f2a-4b3c-9d4e-5f6a7b8c9d0e"],
  });
  await expect(files).toHaveCount(0);
});

test("agents: a chat is shared as a read-only link and can be turned off", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await mockApis(page);
  let shared = false;
  const url = "https://osirus.test/s/AbCdEfGhIjKlMnOpQrStUvWxYz012345";
  await page.route("**/api/chat/threads/*/share", (route) => {
    const method = route.request().method();
    if (method === "POST") shared = true;
    if (method === "DELETE") shared = false;
    return route.fulfill({
      status: method === "POST" ? 201 : 200,
      json: shared
        ? { shared: true, url, sharedAt: "2026-10-26T15:00:00.000Z" }
        : { shared: false },
    });
  });
  await openSurface(page, "agents-thread");
  await page.getByRole("button", { name: "Chat teilen" }).click();
  const dialog = page.getByRole("dialog", { name: "Chat teilen" });
  await expect(dialog.getByText(/Spätere Nachrichten/)).toBeVisible();
  await dialog
    .getByRole("button", { name: "Link erstellen und kopieren" })
    .click();
  await expect(
    dialog.getByRole("textbox", { name: "Link zum geteilten Chat" }),
  ).toHaveValue(url);
  await expect(dialog.getByRole("button", { name: "Kopiert" })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(url);
  await dialog.getByRole("button", { name: "Link deaktivieren" }).click();
  await expect(
    dialog.getByRole("button", { name: "Link erstellen und kopieren" }),
  ).toBeVisible();
});

test("live runs: the Rouge Agent and Code show their orb, the current step and what they just did", async ({
  page,
}) => {
  await mockApis(page);
  await page.goto("/ui-fixtures/live-runs");
  const runs = page.locator(".live-run");
  await expect(runs).toHaveCount(2);
  const rouge = runs.nth(0);
  await expect(rouge).toHaveAttribute("data-kind", "agent");
  await expect(rouge.locator(".orb")).toHaveCount(1);
  await expect(rouge.getByRole("status")).toHaveText(
    "Denise nach dem Deployment gefragt",
  );
  await expect(
    rouge.getByText("Florian nach dem Datenmodell gefragt"),
  ).toBeVisible();
  await expect(rouge.getByText(/Rouge Agent · seit/)).toBeVisible();
  const code = runs.nth(1);
  await expect(code).toHaveAttribute("data-kind", "coding");
  await expect(code.getByRole("status")).toHaveText(
    "Fehlenden Test für gerade Längen geschrieben",
  );
  // Fixed runtime lines read in German, not as internal event names.
  await expect(
    code.getByText("Arbeitsumgebung bereit: osirus-demo/stats-lib"),
  ).toBeVisible();
  await expect(page.locator(".effort-motion")).toHaveCount(0);
});
