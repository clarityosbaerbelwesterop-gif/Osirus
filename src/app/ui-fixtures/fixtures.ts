import type { RunSnapshot, RuntimeEvent } from "@/lib/runtime/types";
import type { ShellData } from "@/components/shell/shell-context";

// Deterministic data for the UI fixture surfaces used by visual, responsive,
// accessibility and journey tests. Nothing here touches a database: the
// surfaces render the real components with these props, and the tests answer
// the components' API calls with the payloads below.

export const FIXTURE_IDS = {
  session: "5f1b8a4e-2c1d-4c3e-9a6b-1f2e3d4c5b6a",
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
        id: "6a7b8c9d-0e1f-4a2b-8c3d-4e5f6a7b8c9d",
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
      sessionId: FIXTURE_IDS.session,
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
