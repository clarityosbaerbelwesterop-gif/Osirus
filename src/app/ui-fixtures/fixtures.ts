import type { RunSnapshot, RuntimeEvent } from "@/lib/runtime/types";
import type { ShellData } from "@/components/shell/shell-context";
import type { RoleStatus } from "@/lib/product/model-status";
import type { LabView } from "@/lib/intelligence/lab/view";
import { DEFAULT_SETTINGS } from "@/lib/intelligence/types";

// Deterministic data for the UI fixture surfaces used by visual, responsive,
// accessibility and journey tests. Nothing here touches a database: the
// surfaces render the real components with these props, and the tests answer
// the components' API calls with the payloads below.

export const FIXTURE_IDS = {
  session: "5f1b8a4e-2c1d-4c3e-9a6b-1f2e3d4c5b6a",
  researchSession: "6a7b8c9d-0e1f-4a2b-8c3d-4e5f6a7b8c9d",
  codingRun: "0a9b8c7d-6e5f-4a3b-8c2d-1e0f9a8b7c6d",
  researchRun: "1b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e",
  approval: "2c3d4e5f-6a7b-4c8d-9e0f-1a2b3c4d5e6f",
};

const minutes = (value: number, now: number) =>
  new Date(now - value * 60_000).toISOString();

export function shellFixture(): ShellData {
  const now = Date.now();
  return {
    user: { name: "Bärbel Westerop", email: "baerbel@example.com" },
    workspaceName: "Personal workspace",
    sessions: [
      {
        id: FIXTURE_IDS.session,
        title: "Fix the median bug in stats-lib",
        updatedAt: minutes(2, now),
        pinnedAt: null,
      },
      {
        id: FIXTURE_IDS.researchSession,
        title: "Compare vector databases for small teams",
        updatedAt: minutes(60, now),
        pinnedAt: minutes(30, now),
      },
      {
        id: "7b8c9d0e-1f2a-4b3c-9d4e-5f6a7b8c9d0e",
        title: "Landing page for the bakery",
        updatedAt: minutes(180, now),
        pinnedAt: null,
      },
      {
        id: "8c9d0e1f-2a3b-4c4d-8e5f-6a7b8c9d0e1f",
        title: "Projectile range with drag",
        updatedAt: minutes(1440, now),
        pinnedAt: null,
      },
      {
        id: "9d0e1f2a-3b4c-4d5e-9f6a-7b8c9d0e1f2a",
        title:
          "Quarterly usage analysis for the ops review, including cost per run and failure causes",
        updatedAt: minutes(2880, now),
        pinnedAt: null,
      },
    ],
    counts: { inbox: 2, approvals: 1 },
    isAdmin: true,
    sidebar: "expanded",
    theme: "system",
  };
}

function event(
  runId: string,
  sequence: number,
  type: string,
  summary: string,
  at: string,
  data: Record<string, unknown> = {},
  visibility: RuntimeEvent["visibility"] = "user",
): RuntimeEvent {
  return {
    id: `${runId.slice(0, 8)}-e${sequence}`,
    runId,
    sequence,
    type,
    visibility,
    summary,
    at,
    data,
  };
}

function stage(
  id: string,
  ordinal: number,
  name: string,
  status: string,
  startedMin: number | null,
  completedMin: number | null,
  now: number,
  extra: Record<string, unknown> = {},
) {
  return {
    id,
    ordinal,
    name,
    capability: "coding",
    status,
    verifier_status: null,
    started_at: startedMin === null ? null : minutes(startedMin, now),
    completed_at: completedMin === null ? null : minutes(completedMin, now),
    ...extra,
  };
}

const CODING_OBJECTIVE =
  "Fix the median bug in https://github.com/osirus-demo/stats-lib and open a pull request";

export function codingRunFixture(state: "active" | "done"): RunSnapshot {
  const now = Date.now();
  const run = FIXTURE_IDS.codingRun;
  const active = state === "active";
  const stages = [
    stage("s-ground", 0, "Ground the coding task", "completed", 6, 5.8, now),
    stage("s-open", 1, "Open the coding workspace", "completed", 5.8, 4.9, now),
    stage("s-answer", 2, "Change the code", "completed", 4.9, 2.1, now),
    stage(
      "s-checks",
      3,
      "Run the repository's checks",
      "completed",
      2.1,
      1.2,
      now,
      {
        verifier_status: "verified",
        verification: {
          summary: "Tests and type checks pass on the changed code.",
          checks: [
            { id: "tests", status: "passed", detail: "npm test: 42 passed" },
            {
              id: "typecheck",
              status: "passed",
              detail: "tsc --noEmit: no errors",
            },
          ],
        },
      },
    ),
    stage(
      "s-deliver",
      4,
      "Push the branch and open a pull request",
      active ? "waiting" : "completed",
      1.2,
      active ? null : 0.4,
      now,
    ),
    stage(
      "s-verify",
      5,
      "Verify against the acceptance contract",
      active ? "pending" : "completed",
      active ? null : 0.4,
      active ? null : 0.1,
      now,
      active
        ? {}
        : {
            verifier_status: "verified",
            verification: {
              summary:
                "The fix is covered by a new test and the pull request is open.",
              checks: [
                {
                  id: "change-evidence",
                  status: "passed",
                  detail: "src/median.ts changed; test added",
                },
                {
                  id: "claims-match-evidence",
                  status: "passed",
                  detail: "Answer matches the diff and the check results",
                },
              ],
            },
          },
    ),
  ];
  const events = [
    event(run, 1, "capability.selected", "Routed to Coding", minutes(6, now)),
    event(
      run,
      2,
      "workspace.opened",
      "Opened a sandbox and cloned osirus-demo/stats-lib",
      minutes(5.5, now),
    ),
    event(run, 3, "skill.selected", "Selected 2 skills", minutes(5.4, now), {
      skills: [
        { id: "k1", name: "Test-first bug fixing", version: "1.2" },
        { id: "k2", name: "Repository conventions", version: "1.0" },
      ],
    }),
    event(run, 4, "agent.step", "Read src/median.ts", minutes(4.6, now), {
      toolId: "workspace.read",
    }),
    event(run, 5, "agent.step", "Edited src/median.ts", minutes(3.2, now), {
      toolId: "workspace.replace",
    }),
    event(
      run,
      6,
      "agent.step",
      "Added a failing test for even-length input",
      minutes(2.8, now),
      { toolId: "workspace.write" },
    ),
    event(
      run,
      7,
      "workspace.checks",
      "Tests passed (42) and types check",
      minutes(1.3, now),
    ),
    event(
      run,
      8,
      "memory.retrieved",
      "Used 1 item from earlier work",
      minutes(5.9, now),
      {
        count: 1,
        items: [
          {
            id: "m1",
            verification: "verified",
            excerpt:
              "stats-lib uses vitest and requires a test for every bug fix.",
          },
        ],
      },
    ),
    ...(active
      ? [
          event(
            run,
            9,
            "approval.requested",
            "Waiting for approval to push branch osirus/fix-median",
            minutes(1.1, now),
          ),
        ]
      : [
          event(run, 9, "approval.decided", "Push approved", minutes(0.9, now)),
          event(
            run,
            10,
            "workspace.delivered",
            "Opened pull request #14",
            minutes(0.4, now),
          ),
        ]),
  ];
  const approvals = [
    {
      id: FIXTURE_IDS.approval,
      stage_id: "s-deliver",
      action: "tool:git.deliver",
      risk: "high",
      status: active ? "requested" : "approved",
      request: {
        toolId: "git.deliver",
        title: "Deliver branch",
        effect: "external",
        summary:
          "Push the fix to a new branch and open a pull request for review.",
        fingerprint: JSON.stringify({
          toolId: "git.deliver",
          input: {
            repository: "https://github.com/osirus-demo/stats-lib",
            branch: "osirus/fix-median",
            title: "Fix median for even-length arrays",
            base: "main",
          },
        }),
      },
      created_at: minutes(1.1, now),
      decided_at: active ? null : minutes(0.9, now),
      expires_at: new Date(now + 58 * 60_000).toISOString(),
    },
  ];
  const messages: RunSnapshot["messages"] = [
    {
      id: "m-user",
      role: "user",
      content: CODING_OBJECTIVE,
      createdAt: minutes(6, now),
    },
    ...(active
      ? []
      : [
          {
            id: "m-answer",
            role: "assistant" as const,
            createdAt: minutes(0.1, now),
            content: [
              "Fixed. `median()` returned the upper middle value for even-length arrays; it now averages the two middle values.",
              "",
              "## Changes",
              "",
              "| File | Change |",
              "| --- | --- |",
              "| `src/median.ts` | Average the two middle elements when the length is even |",
              "| `test/median.test.ts` | New test for `[1, 2, 3, 4]` → `2.5` |",
              "",
              "```ts",
              "const mid = Math.floor(sorted.length / 2);",
              "return sorted.length % 2 === 0",
              "  ? (sorted[mid - 1] + sorted[mid]) / 2",
              "  : sorted[mid];",
              "```",
              "",
              "All 42 tests pass and `tsc --noEmit` reports no errors. Pull request: [osirus-demo/stats-lib#14](https://github.com/osirus-demo/stats-lib/pull/14).",
            ].join("\n"),
          },
        ]),
  ];
  return {
    run: {
      id: run,
      sessionId: FIXTURE_IDS.session,
      objective: CODING_OBJECTIVE,
      status: active ? "waiting_for_approval" : "completed",
      cancelRequested: false,
      armId: "coding",
      acceptanceContract: {
        routing: {
          composition: ["coding"],
          reason: "Heuristic match on coding.",
        },
      },
    },
    stages,
    attempts: stages
      .filter((row) => row.started_at)
      .map((row, index) => ({
        id: `a-${index}`,
        stage_id: row.id,
        attempt_number: 1,
        status: row.status === "completed" ? "completed" : "running",
        lease_expires_at: new Date(now + 5 * 60_000).toISOString(),
      })),
    dependencies: stages.slice(1).map((row, index) => ({
      stage_id: row.id,
      depends_on_stage_id: stages[index]!.id,
      kind: "sequence",
    })),
    artifacts: active
      ? []
      : [{ id: "art-1", kind: "pull_request", title: "Pull request #14" }],
    approvals,
    events,
    checkpoints: [],
    messages,
  };
}

const RESEARCH_OBJECTIVE =
  "Research and compare the best vector databases for a small team, with sources";

export function researchRunFixture(): RunSnapshot {
  const now = Date.now();
  const run = FIXTURE_IDS.researchRun;
  return {
    run: {
      id: run,
      sessionId: FIXTURE_IDS.researchSession,
      objective: RESEARCH_OBJECTIVE,
      status: "completed",
      cancelRequested: false,
      armId: "research",
      acceptanceContract: { routing: { composition: ["research"] } },
    },
    stages: [
      {
        id: "r1",
        ordinal: 0,
        name: "Plan the research",
        status: "completed",
        started_at: minutes(9, now),
        completed_at: minutes(8.6, now),
      },
      {
        id: "r2",
        ordinal: 1,
        name: "Search and read sources",
        status: "completed",
        started_at: minutes(8.6, now),
        completed_at: minutes(4, now),
      },
      {
        id: "r3",
        ordinal: 2,
        name: "Synthesize with citations",
        status: "completed",
        started_at: minutes(4, now),
        completed_at: minutes(1.5, now),
      },
      {
        id: "r4",
        ordinal: 3,
        name: "Verify the claims",
        status: "completed",
        started_at: minutes(1.5, now),
        completed_at: minutes(1, now),
        verifier_status: "verified",
        verification: {
          summary:
            "5 of 5 claims are supported by at least one retrieved source.",
          checks: [
            {
              id: "claims-supported",
              status: "passed",
              detail: "Every claim cites a retrieved source",
            },
            {
              id: "source-diversity",
              status: "passed",
              detail: "4 independent publishers",
            },
          ],
        },
      },
    ],
    attempts: [],
    dependencies: [],
    artifacts: [],
    approvals: [],
    events: [
      event(
        run,
        1,
        "research.planned",
        "Planned 3 questions",
        minutes(8.8, now),
      ),
      event(
        run,
        2,
        "research.gathered",
        "Read 6 sources from 4 publishers",
        minutes(4.2, now),
      ),
      event(
        run,
        3,
        "research.synthesised",
        "Wrote the comparison with 5 cited claims",
        minutes(1.6, now),
      ),
    ],
    checkpoints: [],
    messages: [
      {
        id: "rm-user",
        role: "user",
        content: RESEARCH_OBJECTIVE,
        createdAt: minutes(9, now),
      },
      {
        id: "rm-answer",
        role: "assistant",
        createdAt: minutes(1, now),
        content: [
          "For a small team, **pgvector** is the simplest choice if you already run Postgres; **Qdrant** is the strongest dedicated option when you need filtering at scale.[^1][^2]",
          "",
          "| Option | Best for | Operations |",
          "| --- | --- | --- |",
          "| pgvector | Existing Postgres, < 10M vectors | No new service |",
          "| Qdrant | Filtered search, larger corpora | One extra service |",
          "| LanceDB | Embedded, local-first apps | In-process |",
          "",
          "1. Start with pgvector and HNSW indexes.[^1]",
          "2. Move to Qdrant when filtered recall or latency becomes the bottleneck.[^2]",
          "",
          "[^1]: pgvector README, HNSW indexing section.",
          "[^2]: Qdrant documentation, payload filtering.",
        ].join("\n"),
      },
    ],
  };
}

export const workspaceFixture = {
  workspace: {
    driver: "vercel",
    status: "ready",
    repository: "https://github.com/osirus-demo/stats-lib",
    branch: "osirus/fix-median",
    repositoryMap: {
      languages: [
        { language: "TypeScript", files: 18 },
        { language: "JSON", files: 4 },
      ],
      frameworks: ["vitest"],
    },
    commands: [
      { phase: "install", command: "npm ci", source: "package-lock.json" },
      { phase: "test", command: "npm test", source: "package.json" },
      {
        phase: "typecheck",
        command: "npx tsc --noEmit",
        source: "tsconfig.json",
      },
    ],
    commandLog: [
      {
        command: "npm ci",
        cwd: "/repo",
        exitCode: 0,
        durationMs: 14200,
        at: "2026-09-23T10:00:00.000Z",
        stdoutTail: "added 212 packages in 14s",
        stderrTail: "",
      },
      {
        command: "npm test",
        cwd: "/repo",
        exitCode: 1,
        durationMs: 3100,
        at: "2026-09-23T10:01:00.000Z",
        stdoutTail:
          "FAIL test/median.test.ts > median of even-length input\nExpected 2.5, received 3",
        stderrTail: "",
      },
      {
        command: "npm test",
        cwd: "/repo",
        exitCode: 0,
        durationMs: 2900,
        at: "2026-09-23T10:03:00.000Z",
        stdoutTail: "Test Files  6 passed (6)\n     Tests  42 passed (42)",
        stderrTail: "",
      },
    ],
    fileTree: [
      "package.json",
      "src/index.ts",
      "src/median.ts",
      "src/mean.ts",
      "src/quantile.ts",
      "test/median.test.ts",
      "test/mean.test.ts",
      "tsconfig.json",
    ],
    diff: [
      "diff --git a/src/median.ts b/src/median.ts",
      "@@ -3,5 +3,7 @@ export function median(values: number[]) {",
      "   const sorted = [...values].sort((a, b) => a - b);",
      "   const mid = Math.floor(sorted.length / 2);",
      "-  return sorted[mid];",
      "+  return sorted.length % 2 === 0",
      "+    ? (sorted[mid - 1] + sorted[mid]) / 2",
      "+    : sorted[mid];",
      " }",
      "diff --git a/test/median.test.ts b/test/median.test.ts",
      '@@ -8,3 +8,7 @@ describe("median", () => {',
      '+  it("averages the middle pair for even-length input", () => {',
      "+    expect(median([1, 2, 3, 4])).toBe(2.5);",
      "+  });",
    ].join("\n"),
    previewUrl: null,
  },
};

export const researchFixture = {
  documents: [
    {
      id: "d1",
      url: "https://github.com/pgvector/pgvector",
      title: "pgvector: Open-source vector similarity search for Postgres",
      publisher: "pgvector",
      authority: "primary",
      provider: "exa",
      published_at: "2026-05-02T00:00:00.000Z",
    },
    {
      id: "d2",
      url: "https://qdrant.tech/documentation/concepts/filtering/",
      title: "Filtering — Qdrant documentation",
      publisher: "Qdrant",
      authority: "primary",
      provider: "tavily",
      published_at: null,
    },
    {
      id: "d3",
      url: "https://lancedb.github.io/lancedb/",
      title: "LanceDB documentation",
      publisher: "LanceDB",
      authority: "primary",
      provider: "exa",
      published_at: null,
    },
    {
      id: "d4",
      url: "https://www.example-benchmarks.org/vector-db-2026",
      title: "Vector database benchmarks 2026",
      publisher: "Example Benchmarks",
      authority: "secondary",
      provider: "tavily",
      published_at: "2026-03-14T00:00:00.000Z",
    },
  ],
  claims: [
    {
      id: "c1",
      statement: "pgvector supports HNSW indexes inside Postgres.",
      status: "SUPPORTED",
      confidence: 0.92,
      evidence: [
        {
          documentId: "d1",
          relation: "supports",
          excerpt: "pgvector supports HNSW and IVFFlat index types.",
        },
      ],
    },
    {
      id: "c2",
      statement: "Qdrant applies payload filters during vector search.",
      status: "SUPPORTED",
      confidence: 0.88,
      evidence: [
        {
          documentId: "d2",
          relation: "supports",
          excerpt:
            "Qdrant allows you to set conditions when searching or retrieving points.",
        },
      ],
    },
    {
      id: "c3",
      statement: "LanceDB runs in-process without a separate server.",
      status: "SUPPORTED",
      confidence: 0.81,
      evidence: [
        {
          documentId: "d3",
          relation: "supports",
          excerpt:
            "LanceDB is an embedded database that runs in your application process.",
        },
      ],
    },
  ],
};

export function connectionsFixture() {
  const now = Date.now();
  return {
    github: {
      status: "CONNECTED" as const,
      login: "baerbel",
      scopes: ["repo:read", "repo:write"],
      connectedAt: minutes(60 * 24 * 3, now),
      health: {
        last: {
          ok: true,
          latencyMs: 212,
          error: null,
          checkedAt: minutes(2, now),
        },
        lastOkAt: minutes(2, now),
      },
      lastToolCallAt: minutes(35, now),
    },
    mcp: {
      available: true,
      servers: [
        {
          id: "7c1e2d3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f",
          name: "Docs search",
          url: "https://mcp.docs.example.com/mcp",
          hasToken: true,
          enabled: true,
          status: "healthy" as const,
          serverName: "docs-mcp",
          serverVersion: "1.4.2",
          lastCheckedAt: minutes(12, now),
          lastOkAt: minutes(12, now),
          lastLatencyMs: 184,
          lastError: null,
          toolCount: 3,
          enabledToolCount: 1,
          lastToolCallAt: minutes(90, now),
          tools: [
            {
              id: "8d2f3e4a-5b6c-4d7e-8f9a-0b1c2d3e4f5a",
              name: "search_pages",
              description:
                "Search the documentation and return matching pages with titles and URLs.",
              parameters: ["query", "limit"],
              enabled: true,
              reviewedAt: minutes(60, now),
              risk: "high" as const,
            },
            {
              id: "9e3a4f5b-6c7d-4e8f-9a0b-1c2d3e4f5a6b",
              name: "get_page",
              description: "Return the full text of one documentation page.",
              parameters: ["url"],
              enabled: false,
              reviewedAt: null,
              risk: "high" as const,
            },
            {
              id: "0f4b5a6c-7d8e-4f9a-8b1c-2d3e4f5a6b7c",
              name: "create_page",
              description: "Create a new documentation page.",
              parameters: ["title", "body"],
              enabled: false,
              reviewedAt: null,
              risk: "high" as const,
            },
          ],
        },
      ],
    },
  };
}

export function approvalsFixture() {
  const active = codingRunFixture("active");
  return active.approvals.map((row) => ({
    row: { ...row, run_id: active.run.id },
    sessionId: FIXTURE_IDS.session,
    objective: active.run.objective,
  }));
}

export function inboxFixture() {
  const now = Date.now();
  return [
    {
      id: "i1",
      kind: "approval_pending" as const,
      title: "Approve: Push a branch to GitHub",
      body: "For “Fix the median bug in stats-lib and open a pull request”",
      href: "/app/approvals",
      read: false,
      createdAt: minutes(1, now),
    },
    {
      id: "i2",
      kind: "connector_expired" as const,
      title: "GitHub access expired",
      body: "Reconnect GitHub so Osirus can read and push to your repositories again.",
      href: "/app/connections",
      read: false,
      createdAt: minutes(60, now),
    },
    {
      id: "i3",
      kind: "automation_completed" as const,
      title: "Automation finished: Weekday dependency check",
      body: "No outdated dependencies with safe updates. Nothing was changed.",
      href: `/app?session=${FIXTURE_IDS.session}`,
      read: false,
      createdAt: minutes(600, now),
    },
  ];
}

export function automationsFixture() {
  const now = Date.now();
  return [
    {
      id: "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
      name: "Weekday dependency check",
      objective:
        "Check https://github.com/osirus-demo/stats-lib for outdated dependencies and open a pull request with safe updates.",
      trigger: "schedule" as const,
      schedule: { cadence: "weekdays" as const },
      scheduleLabel: "Weekdays, 03:00 UTC",
      policyPreset: "cautious" as const,
      maxCostUsd: 2,
      maxTokens: 200_000,
      allowedTools: ["workspace.write", "workspace.run", "git.deliver"],
      notifyOn: ["completed", "failed", "approval"],
      enabled: true,
      sessionId: FIXTURE_IDS.session,
      nextRunAt: new Date(now + 14 * 3_600_000).toISOString(),
      lastRunAt: minutes(60 * 10, now),
      lastRunId: FIXTURE_IDS.codingRun,
      lastStatus: "completed",
    },
    {
      id: "2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e",
      name: "Summarize finished research",
      objective:
        "Summarize the findings of the run that just finished in five bullet points.",
      trigger: "run_completed" as const,
      schedule: null,
      scheduleLabel: null,
      policyPreset: "balanced" as const,
      maxCostUsd: null,
      maxTokens: null,
      allowedTools: [],
      notifyOn: ["failed", "approval"],
      enabled: false,
      sessionId: null,
      nextRunAt: null,
      lastRunAt: null,
      lastRunId: null,
      lastStatus: null,
    },
  ];
}

export function modelStatusFixture(): RoleStatus[] {
  const now = Date.now();
  return [
    {
      role: "STRONG",
      label: "Strong model",
      state: "unavailable",
      message: "Temporarily unavailable.",
      lastCallAt: new Date(now - 5 * 60_000).toISOString(),
      calls24h: 14,
      failures24h: 3,
      admin: {
        provider: "UnoRouter",
        modelId: "grok-4.6",
        sharesStrong: false,
        failureCategory: "insufficient_credit",
        lastFailureAt: new Date(now - 5 * 60_000).toISOString(),
      },
    },
    {
      role: "FAST",
      label: "Fast model",
      state: "available",
      message: "Answering normally.",
      lastCallAt: new Date(now - 20 * 60_000).toISOString(),
      calls24h: 41,
      failures24h: 0,
      admin: {
        provider: "UnoRouter",
        modelId: "grok-4.6-fast",
        sharesStrong: false,
        failureCategory: null,
        lastFailureAt: null,
      },
    },
    {
      role: "THINKING",
      label: "Thinking model",
      state: "not_used",
      message: "Not used in the last 24 hours.",
      lastCallAt: null,
      calls24h: 0,
      failures24h: 0,
      admin: {
        provider: "UnoRouter",
        modelId: "grok-4.6",
        sharesStrong: true,
        failureCategory: null,
        lastFailureAt: null,
      },
    },
    {
      role: "VERIFY",
      label: "Verification model",
      state: "not_configured",
      message: "Not set up on this deployment.",
      lastCallAt: null,
      calls24h: 0,
      failures24h: 0,
      admin: {
        provider: "UnoRouter",
        modelId: null,
        sharesStrong: false,
        failureCategory: null,
        lastFailureAt: null,
      },
    },
  ];
}

/**
 * The Intelligence Lab mid-cycle, shaped like the first real CI cycles
 * (2026-09-23): a coding cycle that found no improvement once a provider
 * refusal was excluded, and a math cycle testing two challengers.
 */
export function intelligenceLabFixture(): LabView {
  const now = Date.now();
  const cap = (
    id: string,
    name: string,
    status: LabView["capabilities"][number]["status"],
    rate: number | null,
    samples: number,
    depth: number,
    dependsOn: Array<{
      id: string;
      status: LabView["capabilities"][number]["status"];
    }> = [],
    heldBackBy: string | null = null,
  ) => ({
    id,
    name,
    domain: id.split(".")[0]!,
    status,
    rate,
    samples,
    depth,
    dependsOn,
    heldBackBy,
  });
  return {
    generatedAt: new Date(now).toISOString(),
    settings: {
      ...DEFAULT_SETTINGS,
      flags: {
        ...DEFAULT_SETTINGS.flags,
        intelligencePlane: true,
        experiments: true,
        curriculum: true,
        selfPlay: true,
        redIntelligence: true,
        compilation: true,
        strategyEvolution: true,
        skillEvolution: true,
      },
      providerPause: null,
    },
    usage: {
      model_calls: 41,
      tokens: 612_000,
      cost_usd: 0,
      sandbox_minutes: 38,
      chained_ticks: 9,
      trials: 8,
    },
    capabilities: [
      cap("tool.compute", "Compute tool use", "developing", 0.62, 8, 0),
      cap("tool.workspace", "Workspace tools", "strong", 0.83, 6, 0),
      cap("verification.execution", "Execution checks", "strong", 0.83, 6, 0),
      cap("coding.debug", "Debugging failing tests", "strong", 0.83, 6, 1, [
        { id: "tool.workspace", status: "strong" },
        { id: "verification.execution", status: "strong" },
      ]),
      cap("math.quantitative", "Quantitative problems", "weak", 0.25, 8, 1, [
        { id: "tool.compute", status: "developing" },
      ]),
      cap(
        "coding.multi_file",
        "Multi-file changes",
        "developing",
        0.5,
        4,
        2,
        [
          { id: "coding.debug", status: "strong" },
          { id: "tool.compute", status: "developing" },
        ],
        null,
      ),
    ],
    agenda: [
      {
        id: "a1",
        capabilityId: "math.quantitative",
        title: "Improve quantitative reliability",
        rationale: "Verified rate 25% over 8 judged runs; usefulness 0.85.",
        score: 2.94,
        status: "active",
      },
      {
        id: "a2",
        capabilityId: "coding.debug",
        title: "Improve debugging of failing tests",
        rationale: "Verified rate 83% over 6 judged runs; usefulness 0.95.",
        score: 0.97,
        status: "open",
      },
    ],
    cycle: {
      id: "c2",
      capabilityId: "math.quantitative",
      phase: "dev_eval",
      phaseIndex: 7,
      status: "running",
      startedAt: minutes(95, now),
      log: [
        {
          at: minutes(95, now),
          phase: "select_agenda",
          note: 'Selected "Improve quantitative reliability" (score 2.94).',
        },
        {
          at: minutes(94, now),
          phase: "generate_data",
          note: "Suite stocked at level 0: 4 dev, 1 adversarial, 3 holdout; labels verified 8, rejected 0.",
        },
        {
          at: minutes(52, now),
          phase: "analyze",
          note: 'Champion verified 2/8. Gaps: tool "numbers stated without the compute tool" ×4.',
        },
        {
          at: minutes(51, now),
          phase: "hypothesize",
          note: "Hypotheses: [tool] Numbers stated without the compute tool are often wrong. | [verification] The final value is not stated unambiguously.",
        },
        {
          at: minutes(51, now),
          phase: "design",
          note: "Challengers: v2 (compute first), v3 (final line) on the same 4 dev tasks.",
        },
      ],
    },
    history: [
      {
        id: "c1",
        capabilityId: "coding.debug",
        status: "completed",
        startedAt: minutes(600, now),
        completedAt: minutes(500, now),
        outcome: "no_improvement",
        summary:
          "No challenger passed the dev screen (P(better) >= 0.6 with at least as many challenger-only successes).",
        why: null,
        next: "Improve quantitative reliability",
      },
    ],
    experiments: [
      {
        id: "e1",
        capabilityId: "coding.debug",
        status: "concluded",
        championLabel: "coding.debug v1",
        challengers: [
          {
            label: "coding.debug v2",
            genome: "tier DEEP, reproduce first",
            status: "rejected",
          },
          {
            label: "coding.debug v3",
            genome: "context 6000",
            status: "rejected",
          },
        ],
        outcome: "no_improvement",
        summary: "No challenger passed the dev screen.",
        comparisons: [
          {
            versionId: "v2",
            partition: "dev",
            tasks: 3,
            champion: { verified: 2, n: 3 },
            challenger: { verified: 2, n: 3 },
            probabilityBetter: 0.5,
            discordant: { challengerOnly: 0, championOnly: 0 },
            signTestP: 1,
            costRatio: 1.2,
            falseCompletionDelta: 0,
          },
        ],
      },
    ],
    strategies: [
      {
        strategyId: "math.quantitative",
        versions: [
          {
            id: "m3",
            version: 3,
            status: "experimental",
            genome: "final line",
            rationale:
              "Correct work is lost because the final value is not stated unambiguously.",
            canaryPercent: 0,
            model: "deepseek-v4-pro-0813:free",
          },
          {
            id: "m2",
            version: 2,
            status: "experimental",
            genome: "compute first",
            rationale:
              "Numbers stated without the compute tool are often wrong.",
            canaryPercent: 0,
            model: "deepseek-v4-pro-0813:free",
          },
          {
            id: "m1",
            version: 1,
            status: "champion",
            genome: "baseline",
            rationale:
              "The strategy the agent shipped with, before the Foundry.",
            canaryPercent: 0,
            model: "deepseek-v4-pro-0813:free",
          },
        ],
      },
    ],
    generation: [
      {
        kind: "self_play",
        produced: 2,
        verified: 2,
        rejected: 0,
        note: "developer vs bug generator",
      },
      {
        kind: "red",
        produced: 13,
        verified: 13,
        rejected: 0,
        note: "traps: memory conflict, context overflow, readme injection",
      },
      {
        kind: "curriculum",
        produced: 8,
        verified: 8,
        rejected: 0,
        note: "level 1",
      },
    ],
    datasets: [
      {
        id: "d1",
        datasetId: "coding.debug.problem_solution",
        version: 1,
        counts: { train: 4, dev: 1 },
        contaminated: 0,
      },
      {
        id: "d2",
        datasetId: "coding.debug.failure_repair",
        version: 1,
        counts: { train: 1 },
        contaminated: 0,
      },
    ],
    experience: {
      total: 17,
      verified: 7,
      failures: 6,
      bySource: { trial: 17 },
    },
    artifacts: {
      strategic_memory: 2,
      procedural_memory: 3,
      failure_pattern: 2,
      router_stat: 2,
    },
    strategicMemory: [
      {
        pattern: "coding.debug level 1",
        content: "coding.debug v1 · baseline · 67% verified",
        support: 3,
      },
    ],
    models: [
      {
        modelId: "unorouter:deepseek-v4-pro-0813:free",
        capabilityId: "coding.debug",
        trials: 6,
        verified: 5,
        champion: true,
      },
      {
        modelId: "unorouter:deepseek-v4-pro-0813:free",
        capabilityId: "math.quantitative",
        trials: 8,
        verified: 2,
        champion: true,
      },
    ],
    training: {
      available: false,
      reason:
        "No training provider is configured, and model tuning is off by operator decision; the Foundry improves strategies, skills, prompts and routing instead.",
      jobTypes: [],
      baseModels: [],
    },
    promotions: [
      {
        versionId: "v2",
        from: "experimental",
        to: "rejected",
        canaryPercent: null,
        at: minutes(500, now),
        reason: "No challenger passed the dev screen.",
      },
    ],
  };
}
