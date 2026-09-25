import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { scoreCandidates } from "../src/lib/runtime/router-v2";
import type { RunSnapshot } from "../src/lib/runtime/types";
import { approvalView } from "../src/lib/ui/approval-view";
import {
  githubState,
  healthLine,
  mcpState,
} from "../src/lib/ui/connection-state";
import { fixturesEnabled } from "../src/lib/ui/fixtures-flag";
import {
  failureMessage,
  formatDuration,
  relativeTime,
  stageState,
  toolLabel,
} from "../src/lib/ui/labels";
import { deriveRunView, resumeSummary } from "../src/lib/ui/run-view";
import { STARTERS } from "../src/lib/ui/starters";
import {
  autoOpenWorkbench,
  relevantTabs,
  visibleGroups,
} from "../src/lib/ui/workbench-view";
import { Markdown } from "../src/components/chat/markdown";
import { repositoryInObjective } from "../src/lib/coding/repository-ref";

const NOW = Date.parse("2026-09-23T12:00:00.000Z");
const at = (minutesAgo: number) =>
  new Date(NOW - minutesAgo * 60_000).toISOString();

function snapshot(overrides: Partial<RunSnapshot> = {}): RunSnapshot {
  return {
    run: {
      id: "run-1",
      sessionId: "session-1",
      objective: "Fix the bug",
      status: "running",
      cancelRequested: false,
      armId: "general",
      acceptanceContract: null,
    },
    stages: [],
    attempts: [],
    dependencies: [],
    artifacts: [],
    approvals: [],
    events: [],
    checkpoints: [],
    messages: [],
    ...overrides,
  };
}

describe("labels", () => {
  it("collapses stage statuses into what a person tracks", () => {
    expect(stageState("completed")).toBe("done");
    expect(stageState("blocked")).toBe("waiting");
    expect(stageState("cancelled")).toBe("skipped");
    expect(stageState(undefined)).toBe("pending");
  });

  it("formats durations and relative times", () => {
    expect(formatDuration(450)).toBe("450ms");
    expect(formatDuration(12_000)).toBe("12s");
    expect(formatDuration(125_000)).toBe("2m 5s");
    expect(relativeTime(at(3), NOW)).toBe("3m ago");
    expect(relativeTime(new Date(NOW + 30 * 60_000).toISOString(), NOW)).toBe(
      "in 30m",
    );
  });

  it("names tools in plain language, including MCP tools", () => {
    expect(toolLabel("git.deliver")).toBe("Push a branch to GitHub");
    expect(toolLabel("mcp:docs-1a2b3c/search_pages")).toContain("MCP");
  });

  it("explains failures without provider internals", () => {
    const credit = failureMessage(
      "provider_error",
      '{"error":"insufficient balance for key sk-abc"}',
    );
    expect(credit).toContain("free quota or credit is exhausted");
    expect(credit).not.toContain("sk-abc");
    expect(credit).not.toContain("temporarily unavailable");
    expect(failureMessage("agent_loop_exhausted", "rate limited")).toContain(
      "limiting requests",
    );
  });

  it("tells the truth about provider failures (OSIRUS-01)", () => {
    // Quota exhaustion is permanent until the account changes; it must not
    // be worded as a temporary outage.
    const credit = failureMessage("provider_insufficient_credit");
    expect(credit).toContain("quota or credit is exhausted");
    expect(credit).not.toMatch(/temporarily/i);
    // Credentials and configuration are operator problems.
    expect(failureMessage("provider_credential_rejected")).toContain(
      "operator",
    );
    expect(failureMessage("provider_model_not_configured")).toContain(
      "operator",
    );
    // A real outage keeps the honest temporary wording.
    expect(failureMessage("provider_provider_unavailable")).toContain(
      "temporarily unavailable",
    );
    // Rate limiting is a wait, not a death.
    expect(failureMessage("provider_rate_limited")).toContain(
      "waits and retries",
    );
  });
});

describe("approval view", () => {
  const row = {
    id: "a1",
    run_id: "run-1",
    action: "tool:git.deliver",
    risk: "high",
    status: "requested",
    expires_at: at(-30),
    created_at: at(1),
    request: {
      toolId: "git.deliver",
      effect: "external",
      summary: "Push the fix and open a pull request.",
      fingerprint: JSON.stringify({
        toolId: "git.deliver",
        input: {
          repository: "https://github.com/o/r",
          branch: "osirus/fix",
          token: "ghp_should_never_be_shown_0123456789",
          content: "line1\nline2",
        },
      }),
    },
  };

  it("shows what, why, target, scope and risk without JSON", () => {
    const view = approvalView(row, NOW);
    expect(view.title).toBe("Push a branch to GitHub");
    expect(view.why).toBe("Push the fix and open a pull request.");
    expect(view.target).toBe("https://github.com/o/r");
    expect(view.scope).toContain("outside Osirus");
    expect(view.riskTone).toBe("danger");
    expect(view.decidable).toBe(true);
    const text = JSON.stringify(view.details);
    expect(text).not.toContain("ghp_should_never_be_shown");
    expect(view.details.find((d) => d.label === "Token")?.value).toBe(
      "Withheld",
    );
    expect(view.details.find((d) => d.label === "Content")?.value).toBe(
      "2 lines",
    );
  });

  it("treats a requested approval past its expiry as expired", () => {
    const view = approvalView({ ...row, expires_at: at(1) }, NOW);
    expect(view.status).toBe("expired");
    expect(view.decidable).toBe(false);
  });
});

describe("run view", () => {
  const stages = [
    {
      id: "s1",
      name: "Plan",
      status: "completed",
      started_at: at(5),
      completed_at: at(4),
    },
    {
      id: "s2",
      name: "Change the code",
      status: "running",
      started_at: at(4),
      completed_at: null,
    },
    {
      id: "s3",
      name: "Verify",
      status: "pending",
      started_at: null,
      completed_at: null,
    },
  ];

  it("derives progress, the current step and pending approvals", () => {
    const view = deriveRunView(
      snapshot({
        stages,
        events: [
          {
            id: "e1",
            runId: "run-1",
            sequence: 1,
            type: "agent.step",
            visibility: "user",
            summary: "Edited a.ts",
            at: at(1),
            data: {},
          },
          {
            id: "e2",
            runId: "run-1",
            sequence: 2,
            type: "stage.started",
            visibility: "internal",
            summary: "internal",
            at: at(1),
            data: {},
          },
        ],
        approvals: [
          {
            id: "a1",
            status: "requested",
            risk: "high",
            action: "tool:git.deliver",
            request: { toolId: "git.deliver" },
            expires_at: at(-10),
          },
        ],
      }),
      NOW,
    );
    expect(view.doneCount).toBe(1);
    expect(view.totalCount).toBe(3);
    expect(view.current?.name).toBe("Change the code");
    expect(view.currentStep).toBe("Edited a.ts");
    expect(view.evidence).toHaveLength(1);
    expect(view.pendingApprovals).toHaveLength(1);
    expect(view.stages[0]!.durationMs).toBe(60_000);
  });

  it("summarizes what happened while away without replaying events", () => {
    const view = deriveRunView(
      snapshot({
        stages,
        approvals: [
          {
            id: "a1",
            status: "requested",
            risk: "high",
            action: "tool:git.deliver",
            request: { toolId: "git.deliver" },
            expires_at: at(-10),
          },
        ],
      }),
      NOW,
    );
    const summary = resumeSummary(view);
    expect(summary.completed).toEqual(["Plan"]);
    expect(summary.inProgress).toBe("Change the code");
    expect(summary.attention).toEqual(["Approval: Push a branch to GitHub"]);
  });

  it("explains a failed run from the attempt's failure class", () => {
    const view = deriveRunView(
      snapshot({
        run: { ...snapshot().run, status: "failed" },
        stages: [{ id: "s1", name: "Answer", status: "failed" }],
        attempts: [
          {
            id: "t1",
            stage_id: "s1",
            failure_class: "agent_loop_exhausted",
            last_error: "429 rate limited",
          },
        ],
      }),
      NOW,
    );
    expect(view.failure?.stage).toBe("Answer");
    expect(view.failure?.message).toContain("limiting requests");
  });
});

describe("workbench relevance", () => {
  it("keeps the workbench closed and minimal for a plain conversation", () => {
    const plain = snapshot({
      stages: [{ id: "s1", name: "Answer", status: "completed" }],
    });
    expect(autoOpenWorkbench(plain)).toBe(false);
    expect(visibleGroups(plain).map((group) => group.id)).toEqual(["run"]);
  });

  it("shows build views for coding runs and sources for research", () => {
    const coding = snapshot({ run: { ...snapshot().run, armId: "coding" } });
    expect(relevantTabs(coding).has("diff")).toBe(true);
    expect(autoOpenWorkbench(coding)).toBe(true);
    const research = snapshot({
      run: {
        ...snapshot().run,
        armId: "general",
        acceptanceContract: { routing: { composition: ["research"] } },
      },
    });
    expect(relevantTabs(research).has("research")).toBe(true);
    expect(relevantTabs(research).has("files")).toBe(false);
  });
});

describe("connection states", () => {
  it("never calls a connection healthy without a successful check", () => {
    expect(healthLine(null).label).toBe("Not checked yet");
    expect(healthLine({ last: null }).label).toBe("Not checked yet");
    expect(
      healthLine({ last: { ok: true, error: null, checkedAt: at(1) } }).label,
    ).toBe("Healthy");
  });

  it("distinguishes expired credentials from other failures", () => {
    expect(
      githubState("CONNECTED", {
        last: {
          ok: false,
          error: "GitHub no longer accepts this token.",
          checkedAt: at(1),
        },
      }),
    ).toBe("EXPIRED");
    expect(
      githubState("CONNECTED", {
        last: {
          ok: false,
          error: "GitHub could not be reached.",
          checkedAt: at(1),
        },
      }),
    ).toBe("DEGRADED");
    expect(githubState("NOT_CONFIGURED", null)).toBe("NOT_CONFIGURED");
    expect(
      mcpState({
        status: "failed",
        lastError: "The server rejected the credentials.",
      }),
    ).toBe("EXPIRED");
  });
});

describe("home starters", () => {
  const completions: Record<string, [string, string[]]> = {
    build: ["tracks bakery orders with a signup form", ["building"]],
    research: [
      "the best vector databases for small teams, with sources",
      ["research"],
    ],
    code: [
      "octo/stats-lib where median is wrong for even-length arrays",
      ["coding"],
    ],
    analyze: [
      "the range of a projectile launched at 30 m/s and 45 degrees",
      ["math_science"],
    ],
    create: [
      "explains our onboarding process for new engineers",
      ["building", "general"],
    ],
  };
  it.each(STARTERS.map((starter) => [starter.id, starter]))(
    "%s routes to its intended arm once completed",
    (_id, starter) => {
      const [rest, arms] = completions[starter.id]!;
      const [best] = scoreCandidates(`${starter.prefix}${rest}`);
      expect(arms).toContain(best?.armId);
    },
  );

  it("detects the repository the coding arm will open", () => {
    expect(repositoryInObjective("Fix https://github.com/o/r.git please")).toBe(
      "https://github.com/o/r",
    );
  });
});

describe("fixture surfaces", () => {
  it("are off unless explicitly enabled, and never in production", () => {
    expect(fixturesEnabled({})).toBe(false);
    expect(fixturesEnabled({ OSIRUS_UI_FIXTURES: "1" })).toBe(true);
    expect(
      fixturesEnabled({ OSIRUS_UI_FIXTURES: "1", VERCEL_ENV: "production" }),
    ).toBe(false);
  });
});

describe("markdown rendering", () => {
  const render = (content: string) =>
    renderToStaticMarkup(createElement(Markdown, { content }));

  it("never renders raw HTML from model output", () => {
    const html = render(
      'Hello <script>alert(1)</script> <img src=x onerror="alert(2)"> <iframe src="https://evil.test"></iframe>',
    );
    expect(html).not.toMatch(/<(script|iframe|img)\b/i);
    expect(html).not.toMatch(/<[^>]*\sonerror=/i);
    expect(html).toContain("&lt;script&gt;");
  });

  it("drops javascript: and data: links", () => {
    const html = render(
      "[click](javascript:alert(1)) [data](data:text/html;base64,PHNjcmlwdD4=)",
    );
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("data:text/html");
  });

  it("renders images as links so nothing is fetched", () => {
    const html = render("![pixel](https://tracker.test/p.gif)");
    expect(html).not.toContain("<img");
    expect(html).toContain('rel="noopener noreferrer nofollow"');
    expect(html).toContain("Image: pixel");
  });

  it("renders tables, code and footnote citations", () => {
    const html = render(
      "| a | b |\n|---|---|\n| 1 | 2 |\n\n```ts\nconst x = 1;\n```\n\nClaim.[^1]\n\n[^1]: Source.",
    );
    expect(html).toContain("<table>");
    expect(html).toContain("md-code");
    expect(html).toContain("data-footnote-ref");
  });
});
