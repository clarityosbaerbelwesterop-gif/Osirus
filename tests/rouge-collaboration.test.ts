import { afterEach, describe, expect, it, vi } from "vitest";
import { codeHandoffLink } from "@/lib/agents/collaboration-tools";
import { repositoryRef } from "@/lib/connectors/github-tools";
import { namedRepositories } from "@/lib/gateway/repo-material";
import { codingIntentDecision } from "@/lib/coding/intent";

describe("repository references", () => {
  it("reads owner/name and github.com URLs, and refuses anything else", () => {
    expect(repositoryRef("octo/zeus")).toEqual({ owner: "octo", name: "zeus" });
    expect(repositoryRef("https://github.com/octo/zeus.git")).toEqual({
      owner: "octo",
      name: "zeus",
    });
    expect(() => repositoryRef("https://evil.example/octo/zeus")).toThrow(
      "github_repository_invalid",
    );
    expect(() => repositoryRef("../../etc")).toThrow();
  });
});

describe("hand-off from the Rouge Agent to Code", () => {
  it("opens Code with repository, branch and task filled in", () => {
    const link = codeHandoffLink({
      repository: "https://github.com/octo/Zeus",
      branch: "main",
      task: "Bug-Audit & Sicherheitsfehler beheben",
    });
    const url = new URL(link, "https://osirus.test");
    expect(url.pathname).toBe("/app/coding");
    expect(url.searchParams.get("repo")).toBe("octo/Zeus");
    expect(url.searchParams.get("branch")).toBe("main");
    expect(url.searchParams.get("task")).toBe(
      "Bug-Audit & Sicherheitsfehler beheben",
    );
    expect(url.searchParams.get("new")).toBe("1");
  });
});

describe("repositories a chat message names", () => {
  it("finds URLs, owner/name and bare names of known repositories", () => {
    const known = ["octo/Zeus", "octo/api", "octo/docs-site"];
    expect(
      namedRepositories("Schau dir https://github.com/octo/Zeus an"),
    ).toEqual(["octo/Zeus"]);
    expect(namedRepositories("Was steht im Repo Zeus?", known)).toEqual([
      "octo/Zeus",
    ]);
    expect(namedRepositories("Prüfe octo/docs-site bitte", known)).toEqual([
      "octo/docs-site",
    ]);
    // Short or partial names never match inside other words.
    expect(namedRepositories("Die rapid API-Antwort", known)).toEqual([]);
    expect(namedRepositories("Zeusland ist kein Repo", known)).toEqual([]);
  });

  it("reads at most two repositories per message", () => {
    const known = ["o/alpha", "o/beta", "o/gamma"];
    expect(namedRepositories("alpha, beta und gamma", known)).toHaveLength(2);
  });
});

describe("coding approvals", () => {
  it("never asks before reading a file in the sandbox", () => {
    for (const permission of ["ask", "accept-edits"] as const)
      expect(
        codingIntentDecision({ permission, toolId: "workspace.read" }),
      ).toBeNull();
    expect(
      codingIntentDecision({ permission: "ask", toolId: "workspace.write" }),
    ).toBe("ask");
  });
});

describe("GitHub tools", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("offers nothing without a grant, reads with one, writes only with a write grant", async () => {
    vi.resetModules();
    const grants = new Set<string>();
    vi.doMock("@/lib/connectors/github", async (original) => ({
      ...(await original<typeof import("@/lib/connectors/github")>()),
      githubCredential: async (_identity: unknown, scope: string) =>
        grants.has(scope) ? "token" : null,
    }));
    const { githubToolsForWorkspace } =
      await import("@/lib/connectors/github-tools");
    const identity = { userId: "u", organizationId: "o", workspaceId: "w" };
    expect(await githubToolsForWorkspace(identity)).toEqual([]);
    grants.add("repo:read");
    const reads = await githubToolsForWorkspace(identity);
    expect(reads.map((tool) => tool.id)).toEqual([
      "github.repos",
      "github.repo",
      "github.tree",
      "github.file",
    ]);
    expect(reads.every((tool) => tool.effect === "read")).toBe(true);
    grants.add("repo:write");
    const all = await githubToolsForWorkspace(identity);
    const writes = all.filter((tool) => tool.effect !== "read");
    expect(writes.map((tool) => tool.id)).toEqual([
      "github.repo.create",
      "github.file.write",
      "github.pull_request",
      "github.issue",
    ]);
    // Every write reaches GitHub, so every write asks first.
    expect(writes.every((tool) => tool.effect === "external")).toBe(true);
  });

  it("lists empty repositories when asked", async () => {
    vi.doMock("@/lib/connectors/github", async (original) => ({
      ...(await original<typeof import("@/lib/connectors/github")>()),
      githubCredential: async () => "token",
    }));
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify([
          {
            name: "Zeus",
            owner: { login: "octo" },
            size: 120,
            default_branch: "main",
          },
          {
            name: "blank",
            owner: { login: "octo" },
            size: 0,
            default_branch: "main",
          },
        ]),
        { status: 200 },
      ),
    );
    const { githubToolsForWorkspace } =
      await import("@/lib/connectors/github-tools");
    const tools = await githubToolsForWorkspace({
      userId: "u",
      organizationId: "o",
      workspaceId: "w",
    });
    const list = tools.find((tool) => tool.id === "github.repos")!;
    const result = (await list.run({ onlyEmpty: true }, {} as never)) as {
      repositories: Array<{ repository: string; empty: boolean }>;
    };
    expect(result.repositories).toEqual([
      expect.objectContaining({ repository: "octo/blank", empty: true }),
    ]);
  });
});
