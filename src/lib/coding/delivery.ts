import { z } from "zod";
import type { ToolDefinition } from "../tools/registry";
import { REPO_DIR, type CodingWorkspace } from "./workspace";

// Delivery: branch, commit, push, pull request.
//
// The only path by which work leaves the workspace. It is an external,
// high-risk tool, so the registry refuses it without an approval on the run;
// it also needs a GitHub write grant, and without one it says so instead of
// trying. It never pushes to the default branch and never force-pushes.

const BRANCH = /^(?!.*\.\.)(?!.*\/\/)(?!\/)(?!.*\/$)[A-Za-z0-9._/-]{1,100}$/;
const PROTECTED = new Set(["main", "master", "trunk", "develop", "production"]);

export function validBranchName(branch: string, base: string) {
  if (!BRANCH.test(branch)) return "branch_name_invalid";
  if (branch === base || PROTECTED.has(branch)) return "branch_is_protected";
  if (branch.startsWith("-")) return "branch_name_invalid";
  return null;
}

const IDENTITY = [
  "-c",
  "user.email=agent@osirus.local",
  "-c",
  "user.name=Osirus",
];

export async function commitAll(
  workspace: CodingWorkspace,
  input: { branch: string; base: string; message: string },
) {
  const refusal = validBranchName(input.branch, input.base);
  if (refusal) throw new Error(refusal);
  const status = await workspace.gitStatus();
  if (!status.trim()) throw new Error("nothing_to_commit");
  const checkout = await workspace.exec("git", [
    "checkout",
    "-B",
    input.branch,
  ]);
  if (checkout.exitCode !== 0) throw new Error("checkout_failed");
  await workspace.exec("git", [...IDENTITY, "add", "-A"]);
  const commit = await workspace.exec("git", [
    ...IDENTITY,
    "commit",
    "-q",
    "-m",
    input.message.slice(0, 2_000),
  ]);
  if (commit.exitCode !== 0) throw new Error("commit_failed");
  const head = await workspace.exec("git", ["rev-parse", "HEAD"], {
    record: false,
  });
  return { sha: head.stdout.trim() };
}

/**
 * Push the branch. The token reaches git through this one command's
 * environment and a credential helper that reads it -- not an argument, not
 * the remote URL, not the repository config -- and the workspace redacts it
 * from anything it records.
 */
export async function pushBranch(
  workspace: CodingWorkspace,
  input: { branch: string; token?: string },
) {
  if (input.token) workspace.addSecret(input.token);
  const result = await workspace.exec(
    "git",
    [
      "-c",
      "credential.helper=",
      ...(input.token
        ? [
            "-c",
            "credential.helper=!f() { echo username=x-access-token; echo password=$GIT_TOKEN; }; f",
          ]
        : []),
      "push",
      "origin",
      `HEAD:refs/heads/${input.branch}`,
    ],
    {
      cwd: REPO_DIR,
      timeoutMs: 120_000,
      env: input.token ? { GIT_TOKEN: input.token } : undefined,
    },
  );
  if (result.exitCode !== 0)
    throw new Error(`push_failed:${result.stderr.slice(-200)}`);
  return result;
}

export type DeliveryDependencies = {
  workspace: () => Promise<CodingWorkspace>;
  /** owner/name of the repository the workspace was cloned from. */
  repository: () => { owner: string; name: string } | null;
  baseBranch: () => string;
  /** A token with the write grant, or null. Never cached by the tool. */
  writeCredential: () => Promise<string | null>;
  openPullRequest: (input: {
    token: string;
    owner: string;
    name: string;
    head: string;
    base: string;
    title: string;
    body: string;
  }) => Promise<{ url: string | null; number: number | null }>;
};

export function deliveryTool(deps: DeliveryDependencies): ToolDefinition {
  return {
    id: "git.deliver",
    title: "Deliver as a pull request",
    summary:
      "Commit the workspace changes to a new branch, push it to GitHub and open a pull request. Requires approval and a GitHub write grant.",
    trust: "connector",
    effect: "external",
    risk: "high",
    arms: ["coding", "building"],
    inputSchema: z.object({
      branch: z.string().min(1).max(100),
      commitMessage: z.string().min(1).max(2_000),
      title: z.string().min(1).max(200),
      body: z.string().max(10_000),
    }),
    run: async (input) => {
      const request = input as {
        branch: string;
        commitMessage: string;
        title: string;
        body: string;
      };
      const repository = deps.repository();
      if (!repository)
        throw new Error("no_github_repository_in_this_workspace");
      const token = await deps.writeCredential();
      if (!token)
        throw new Error(
          "github_write_grant_missing: connect GitHub with write access for this workspace",
        );
      const workspace = await deps.workspace();
      const base = deps.baseBranch();
      const { sha } = await commitAll(workspace, {
        branch: request.branch,
        base,
        message: request.commitMessage,
      });
      await pushBranch(workspace, { branch: request.branch, token });
      const pr = await deps.openPullRequest({
        token,
        owner: repository.owner,
        name: repository.name,
        head: request.branch,
        base,
        title: request.title,
        body: request.body,
      });
      return { branch: request.branch, sha, pullRequest: pr };
    },
  };
}
