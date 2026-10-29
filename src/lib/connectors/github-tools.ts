import "server-only";
import { z } from "zod";
import type { ToolDefinition } from "../tools/registry";
import { githubCredential, parseGithubRepository } from "./github";

// The connected GitHub grant as tools for the Rouge Agent and Code.
//
// Reads (list, inspect, read a file, list a tree) need the read grant and
// change nothing, so they never ask. Writes (create a repository, write a
// file on a branch, open a pull request or an issue) reach GitHub, which
// other people can see: they are "external" and every call goes through
// the approval gate with its exact input. The token is fetched per call,
// sent only to api.github.com, and never returned or put in a prompt.

type Identity = { userId: string; organizationId: string; workspaceId: string };

const API = "https://api.github.com";
const ARMS: ToolDefinition["arms"] = [
  "general",
  "thinking",
  "coding",
  "research",
  "building",
];
const FILE_CHARS = 60_000;
const README_CHARS = 4_000;

const repositoryInput = z
  .string()
  .min(3)
  .max(200)
  .describe("owner/name or https://github.com/owner/name");

export function repositoryRef(value: string) {
  const text = value.trim().replace(/\.git$/, "");
  const url = text.startsWith("https://")
    ? text
    : `https://github.com/${text.replace(/^github\.com\//, "")}`;
  const parsed = parseGithubRepository(url);
  if (!parsed) throw new Error("github_repository_invalid");
  return parsed;
}

function pathSegments(path: string) {
  return path
    .replace(/^\/+/, "")
    .split("/")
    .filter(Boolean)
    .map(encodeURIComponent)
    .join("/");
}

async function call(
  token: string,
  path: string,
  init: { method?: string; body?: unknown } = {},
) {
  const response = await fetch(`${API}${path}`, {
    method: init.method ?? "GET",
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      "user-agent": "osirus",
      ...(init.body ? { "content-type": "application/json" } : {}),
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  });
  const body = (await response.json().catch(() => null)) as unknown;
  return { status: response.status, ok: response.ok, body };
}

function fail(status: number, body: unknown): never {
  const message =
    body && typeof body === "object" && "message" in body
      ? String((body as { message?: unknown }).message ?? "").slice(0, 160)
      : "";
  throw new Error(`github_${status}${message ? `: ${message}` : ""}`);
}

const record = (value: unknown) =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : {};
const text = (value: unknown) =>
  typeof value === "string" && value ? value : null;

function repoSummary(entry: unknown) {
  const row = record(entry);
  const size = typeof row.size === "number" ? row.size : null;
  return {
    repository: `${text(record(row.owner).login) ?? "?"}/${text(row.name) ?? "?"}`,
    private: Boolean(row.private),
    description: text(row.description),
    defaultBranch: text(row.default_branch) ?? "main",
    language: text(row.language),
    sizeKb: size,
    // GitHub reports size 0 for a repository without any commit.
    empty: size === 0,
    pushedAt: text(row.pushed_at),
  };
}

/** Tools for the grant this workspace connected; none without a read grant. */
export async function githubToolsForWorkspace(
  identity: Identity,
): Promise<ToolDefinition[]> {
  const readToken = await githubCredential(identity, "repo:read").catch(
    () => null,
  );
  if (!readToken) return [];
  const writeGranted = Boolean(
    await githubCredential(identity, "repo:write").catch(() => null),
  );
  const read = async () => {
    const token = await githubCredential(identity, "repo:read");
    if (!token) throw new Error("github_not_connected");
    return token;
  };
  const write = async () => {
    const token = await githubCredential(identity, "repo:write");
    if (!token) throw new Error("github_write_grant_missing");
    return token;
  };

  const tools: ToolDefinition[] = [
    {
      id: "github.repos",
      title: "GitHub-Repositories auflisten",
      summary:
        "The person's GitHub repositories this workspace may see: name, visibility, default branch, size, whether it is empty (no commit yet), language, last push. Filter by text or to empty ones.",
      trust: "connector",
      effect: "read",
      risk: "low",
      arms: ARMS,
      inputSchema: z.object({
        query: z.string().max(100).optional(),
        onlyEmpty: z.boolean().optional(),
      }),
      run: async (input) => {
        const args = input as { query?: string; onlyEmpty?: boolean };
        const result = await call(
          await read(),
          "/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member",
        );
        if (!result.ok) fail(result.status, result.body);
        const query = args.query?.trim().toLowerCase();
        const repositories = (Array.isArray(result.body) ? result.body : [])
          .map(repoSummary)
          .filter((repo) => !args.onlyEmpty || repo.empty)
          .filter(
            (repo) =>
              !query ||
              repo.repository.toLowerCase().includes(query) ||
              (repo.description ?? "").toLowerCase().includes(query),
          );
        return { count: repositories.length, repositories };
      },
    },
    {
      id: "github.repo",
      title: "GitHub-Repository ansehen",
      summary:
        "One repository: description, default branch, branches, top-level files and folders, and the start of the README. Says plainly when the repository is empty.",
      trust: "connector",
      effect: "read",
      risk: "low",
      arms: ARMS,
      inputSchema: z.object({ repository: repositoryInput }),
      run: async (input) => {
        const { owner, name } = repositoryRef(
          (input as { repository: string }).repository,
        );
        const token = await read();
        const base = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
        const repo = await call(token, base);
        if (!repo.ok) fail(repo.status, repo.body);
        const summary = repoSummary(repo.body);
        const [branches, contents, readme] = await Promise.all([
          call(token, `${base}/branches?per_page=50`),
          call(token, `${base}/contents`),
          call(token, `${base}/readme`),
        ]);
        const branchNames = Array.isArray(branches.body)
          ? branches.body
              .map((entry) => text(record(entry).name))
              .filter((value): value is string => Boolean(value))
          : [];
        const top = Array.isArray(contents.body)
          ? contents.body.map((entry) => ({
              path: text(record(entry).path),
              type: text(record(entry).type),
            }))
          : [];
        const readmeText =
          readme.ok && text(record(readme.body).content)
            ? Buffer.from(String(record(readme.body).content), "base64")
                .toString("utf8")
                .slice(0, README_CHARS)
            : null;
        return {
          ...summary,
          // An empty repository answers 409 on contents and has no branch.
          empty:
            summary.empty ||
            contents.status === 409 ||
            /repository is empty/i.test(
              String(record(contents.body).message ?? ""),
            ),
          branches: branchNames,
          topLevel: top,
          readme: readmeText,
        };
      },
    },
    {
      id: "github.tree",
      title: "Dateien eines GitHub-Repositorys auflisten",
      summary:
        "Every file path of a repository at a branch or commit (up to 2000), to find what to read.",
      trust: "connector",
      effect: "read",
      risk: "low",
      arms: ARMS,
      inputSchema: z.object({
        repository: repositoryInput,
        ref: z.string().max(200).optional(),
      }),
      run: async (input) => {
        const args = input as { repository: string; ref?: string };
        const { owner, name } = repositoryRef(args.repository);
        const token = await read();
        const base = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
        let ref = args.ref?.trim();
        if (!ref) {
          const repo = await call(token, base);
          if (!repo.ok) fail(repo.status, repo.body);
          ref = repoSummary(repo.body).defaultBranch;
        }
        const tree = await call(
          token,
          `${base}/git/trees/${encodeURIComponent(ref)}?recursive=1`,
        );
        if (tree.status === 409) return { empty: true, paths: [] };
        if (!tree.ok) fail(tree.status, tree.body);
        const entries = Array.isArray(record(tree.body).tree)
          ? (record(tree.body).tree as unknown[])
          : [];
        const paths = entries
          .filter((entry) => record(entry).type === "blob")
          .map((entry) => text(record(entry).path))
          .filter((value): value is string => Boolean(value));
        return {
          ref,
          count: paths.length,
          truncated:
            Boolean(record(tree.body).truncated) || paths.length > 2000,
          paths: paths.slice(0, 2000),
        };
      },
    },
    {
      id: "github.file",
      title: "Datei auf GitHub lesen",
      summary:
        "The text of one file (or the entries of one folder) in a repository at a branch or commit.",
      trust: "connector",
      effect: "read",
      risk: "low",
      arms: ARMS,
      inputSchema: z.object({
        repository: repositoryInput,
        path: z.string().min(1).max(500),
        ref: z.string().max(200).optional(),
      }),
      run: async (input) => {
        const args = input as {
          repository: string;
          path: string;
          ref?: string;
        };
        const { owner, name } = repositoryRef(args.repository);
        const ref = args.ref?.trim();
        const result = await call(
          await read(),
          `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/contents/${pathSegments(args.path)}${ref ? `?ref=${encodeURIComponent(ref)}` : ""}`,
        );
        if (!result.ok) fail(result.status, result.body);
        if (Array.isArray(result.body))
          return {
            folder: args.path,
            entries: result.body.map((entry) => ({
              path: text(record(entry).path),
              type: text(record(entry).type),
            })),
          };
        const file = record(result.body);
        const content = text(file.content);
        const decoded = content
          ? Buffer.from(content, "base64").toString("utf8")
          : "";
        return {
          path: text(file.path),
          size: typeof file.size === "number" ? file.size : null,
          truncated: decoded.length > FILE_CHARS,
          content: decoded.slice(0, FILE_CHARS),
        };
      },
    },
  ];

  if (!writeGranted) return tools;

  tools.push(
    {
      id: "github.repo.create",
      title: "GitHub-Repository anlegen",
      summary:
        "Create a repository under the connected account (private unless asked otherwise). Asks for approval first.",
      trust: "connector",
      effect: "external",
      risk: "medium",
      arms: ARMS,
      inputSchema: z.object({
        name: z
          .string()
          .min(1)
          .max(100)
          .regex(/^[A-Za-z0-9._-]+$/),
        description: z.string().max(350).optional(),
        private: z.boolean().optional(),
        initialize: z
          .boolean()
          .optional()
          .describe("Create a first commit with a README"),
      }),
      run: async (input) => {
        const args = input as {
          name: string;
          description?: string;
          private?: boolean;
          initialize?: boolean;
        };
        const result = await call(await write(), "/user/repos", {
          method: "POST",
          body: {
            name: args.name,
            description: args.description ?? "",
            private: args.private ?? true,
            auto_init: args.initialize ?? false,
          },
        });
        if (!result.ok) fail(result.status, result.body);
        return {
          ...repoSummary(result.body),
          url: text(record(result.body).html_url),
        };
      },
    },
    {
      id: "github.file.write",
      title: "Datei auf GitHub schreiben",
      summary:
        "Create or replace one file on a branch, as one commit. A missing branch is created from the default branch. Asks for approval first.",
      trust: "connector",
      effect: "external",
      risk: "medium",
      arms: ARMS,
      inputSchema: z.object({
        repository: repositoryInput,
        path: z.string().min(1).max(500),
        content: z.string().max(200_000),
        message: z.string().min(1).max(300),
        branch: z.string().max(200).optional(),
      }),
      run: async (input) => {
        const args = input as {
          repository: string;
          path: string;
          content: string;
          message: string;
          branch?: string;
        };
        const { owner, name } = repositoryRef(args.repository);
        const token = await write();
        const base = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
        const repo = await call(token, base);
        if (!repo.ok) fail(repo.status, repo.body);
        const summary = repoSummary(repo.body);
        let branch = args.branch?.trim() || summary.defaultBranch;
        let createdBranch = false;
        const head = await call(
          token,
          `${base}/git/ref/heads/${pathSegments(summary.defaultBranch)}`,
        );
        const repositoryEmpty = head.status === 409 || head.status === 404;
        if (repositoryEmpty) {
          // The first commit of an empty repository lands on its default
          // branch; a feature branch can only start from a commit.
          branch = summary.defaultBranch;
        } else if (branch !== summary.defaultBranch) {
          const existing = await call(
            token,
            `${base}/git/ref/heads/${pathSegments(branch)}`,
          );
          if (existing.status === 404) {
            const sha = text(record(record(head.body).object).sha);
            if (!sha) fail(head.status, head.body);
            const created = await call(token, `${base}/git/refs`, {
              method: "POST",
              body: { ref: `refs/heads/${branch}`, sha },
            });
            if (!created.ok) fail(created.status, created.body);
            createdBranch = true;
          } else if (!existing.ok) fail(existing.status, existing.body);
        }
        const current = repositoryEmpty
          ? null
          : await call(
              token,
              `${base}/contents/${pathSegments(args.path)}?ref=${encodeURIComponent(branch)}`,
            );
        const sha =
          current?.ok && !Array.isArray(current.body)
            ? text(record(current.body).sha)
            : null;
        const result = await call(
          token,
          `${base}/contents/${pathSegments(args.path)}`,
          {
            method: "PUT",
            body: {
              message: args.message,
              content: Buffer.from(args.content, "utf8").toString("base64"),
              ...(repositoryEmpty ? {} : { branch }),
              ...(sha ? { sha } : {}),
            },
          },
        );
        if (!result.ok) fail(result.status, result.body);
        return {
          repository: `${owner}/${name}`,
          branch,
          createdBranch,
          path: args.path,
          replaced: Boolean(sha),
          commit: text(record(record(result.body).commit).sha)?.slice(0, 12),
          url: text(record(record(result.body).content).html_url),
        };
      },
    },
    {
      id: "github.pull_request",
      title: "Pull Request öffnen",
      summary:
        "Open a pull request from a branch into the default (or a named) branch. Asks for approval first.",
      trust: "connector",
      effect: "external",
      risk: "medium",
      arms: ARMS,
      inputSchema: z.object({
        repository: repositoryInput,
        head: z.string().min(1).max(200),
        base: z.string().max(200).optional(),
        title: z.string().min(1).max(200),
        body: z.string().max(20_000).optional(),
      }),
      run: async (input) => {
        const args = input as {
          repository: string;
          head: string;
          base?: string;
          title: string;
          body?: string;
        };
        const { owner, name } = repositoryRef(args.repository);
        const token = await write();
        const base = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
        let target = args.base?.trim();
        if (!target) {
          const repo = await call(token, base);
          if (!repo.ok) fail(repo.status, repo.body);
          target = repoSummary(repo.body).defaultBranch;
        }
        const result = await call(token, `${base}/pulls`, {
          method: "POST",
          body: {
            title: args.title,
            body: args.body ?? "",
            head: args.head,
            base: target,
          },
        });
        if (!result.ok) fail(result.status, result.body);
        return {
          number: record(result.body).number ?? null,
          url: text(record(result.body).html_url),
        };
      },
    },
    {
      id: "github.issue",
      title: "Issue anlegen",
      summary:
        "Open an issue in a repository, for example one per finding of an audit. Asks for approval first.",
      trust: "connector",
      effect: "external",
      risk: "medium",
      arms: ARMS,
      inputSchema: z.object({
        repository: repositoryInput,
        title: z.string().min(1).max(250),
        body: z.string().max(20_000).optional(),
        labels: z.array(z.string().max(50)).max(10).optional(),
      }),
      run: async (input) => {
        const args = input as {
          repository: string;
          title: string;
          body?: string;
          labels?: string[];
        };
        const { owner, name } = repositoryRef(args.repository);
        const result = await call(
          await write(),
          `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/issues`,
          {
            method: "POST",
            body: {
              title: args.title,
              body: args.body ?? "",
              ...(args.labels?.length ? { labels: args.labels } : {}),
            },
          },
        );
        if (!result.ok) fail(result.status, result.body);
        return {
          number: record(result.body).number ?? null,
          url: text(record(result.body).html_url),
        };
      },
    },
  );
  return tools;
}
