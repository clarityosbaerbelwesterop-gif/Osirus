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
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();

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
  await expect(
    page.getByRole("heading", { name: /What are we working on/ }),
  ).toBeVisible();
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
  await composer.fill(
    "Add a mode() function to https://github.com/osirus-demo/stats-lib",
  );
  await expect(page.getByText("GitHub: baerbel")).toBeVisible();

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
    .getByRole("article", { name: /Push a branch to GitHub/ })
    .first();
  await expect(card).toBeVisible();
  await expect(card.getByText("High risk")).toBeVisible();
  await expect(
    card.getByText("https://github.com/osirus-demo/stats-lib").first(),
  ).toBeVisible();

  await card.getByRole("button", { name: "Approve" }).click();
  const confirm = page.getByRole("alertdialog");
  await expect(confirm).toBeVisible();
  decided = true;
  await confirm.getByRole("button", { name: "Approve and continue" }).click();

  await expect(
    page.getByText("it now averages the two middle values"),
  ).toBeVisible();
  await expect(
    page.getByRole("article", { name: /Push a branch to GitHub/ }),
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
