import { z } from "zod";
import type { ArmId } from "../arms/types";
import type { ToolDefinition } from "../tools/registry";
import type { DiscoveredCommand } from "./commands";
import { analyzeFailure } from "./failure";
import type { CodingWorkspace } from "./workspace";

// The repository as tools.
//
// Every path is resolved through CodingWorkspace.resolve (syntax check, then
// realpath inside the repository), every command is an argument array, and
// every result goes back to the model as untrusted data -- a README that says
// "delete the tests" is text the agent read, not an instruction it received.

const CODING_ARMS: ArmId[] = ["coding", "building"];

const path = z.string().min(1).max(400);

/**
 * Programs the agent may start with arguments of its choosing.
 *
 * The workspace is the isolation boundary, not this list; the list keeps the
 * agent to development tools and keeps out the ones that exist to move data or
 * credentials: no shells, no curl, no git push or remote changes (delivery is
 * its own tool, behind approval), no package publishing.
 */
const ALLOWED_PROGRAMS = new Set([
  "node",
  "npm",
  "npx",
  "pnpm",
  "yarn",
  "bun",
  "python3",
  "python",
  "pytest",
  "cargo",
  "go",
  "make",
  "git",
  "ls",
  "cat",
  "head",
  "tail",
  "wc",
  "diff",
]);

const GIT_SUBCOMMANDS = new Set([
  "status",
  "diff",
  "log",
  "show",
  "add",
  "commit",
  "checkout",
  "switch",
  "restore",
  "stash",
  "rev-parse",
  "branch",
  "ls-files",
  "grep",
  "blame",
  "reset",
]);

const FORBIDDEN_PACKAGE_ACTIONS = new Set([
  "publish",
  "login",
  "logout",
  "adduser",
  "token",
  "owner",
  "unpublish",
  "deprecate",
  "config",
]);

export function commandPermitted(cmd: string, args: string[]) {
  if (!ALLOWED_PROGRAMS.has(cmd)) return `program_not_allowed:${cmd}`;
  if (args.some((arg) => arg.includes("\u0000"))) return "nul_in_argument";
  if (cmd === "git") {
    const sub = args.find((arg) => !arg.startsWith("-"));
    // `-c` lets a caller set any config for the call, including a credential
    // helper or core.sshCommand. The agent does not get that.
    // `-C`, `--git-dir` and `--work-tree` point git outside the repository.
    if (
      args.some(
        (arg) =>
          arg === "-c" ||
          arg === "-C" ||
          /^--(exec|git-dir|work-tree|upload-pack|receive-pack|config-env)/.test(
            arg,
          ),
      )
    )
      return "git_option_not_allowed";
    if (!sub || !GIT_SUBCOMMANDS.has(sub))
      return `git_subcommand_not_allowed:${sub ?? "none"}`;
  }
  if (["npm", "pnpm", "yarn", "bun"].includes(cmd)) {
    const action = args.find((arg) => !arg.startsWith("-"));
    if (action && FORBIDDEN_PACKAGE_ACTIONS.has(action))
      return `package_action_not_allowed:${action}`;
  }
  return null;
}

function tail(text: string, size = 6_000) {
  return text.length > size ? `…${text.slice(-size)}` : text;
}

export function workspaceTools(
  workspace: () => Promise<CodingWorkspace>,
  commands: () => DiscoveredCommand[],
  onChange?: () => void,
): ToolDefinition[] {
  const read = (
    definition: Omit<ToolDefinition, "trust" | "effect" | "risk" | "arms">,
  ): ToolDefinition => ({
    ...definition,
    trust: "builtin",
    effect: "read",
    risk: "low",
    arms: CODING_ARMS,
  });
  const write = (
    definition: Omit<ToolDefinition, "trust" | "effect" | "risk" | "arms">,
    risk: "low" | "medium" = "low",
  ): ToolDefinition => ({
    ...definition,
    trust: "builtin",
    effect: "write",
    risk,
    arms: CODING_ARMS,
  });

  return [
    read({
      id: "workspace.tree",
      title: "List repository files",
      summary: "List files and directories in the repository (depth-limited).",
      inputSchema: z.object({
        path: path.optional(),
        depth: z.number().int().min(1).max(8).optional(),
      }),
      run: async (input) => {
        const { path: dir, depth } = input as { path?: string; depth?: number };
        const entries = await (await workspace()).tree(dir ?? ".", depth ?? 3);
        return { entries, count: entries.length };
      },
    }),
    read({
      id: "workspace.read",
      title: "Read a file",
      summary:
        "Read a text file from the repository. Binary files are refused.",
      inputSchema: z.object({
        path,
        maxBytes: z.number().int().min(1).max(200_000).optional(),
      }),
      run: async (input) => {
        const { path: file, maxBytes } = input as {
          path: string;
          maxBytes?: number;
        };
        const content = await (await workspace()).read(file, maxBytes);
        return { path: file, content, bytes: content.length };
      },
    }),
    read({
      id: "workspace.search",
      title: "Search the repository",
      summary:
        "Fixed-string search across the repository; returns file:line:text matches.",
      inputSchema: z.object({
        text: z.string().min(1).max(200),
        path: path.optional(),
      }),
      run: async (input) => {
        const { text, path: dir } = input as { text: string; path?: string };
        const matches = await (await workspace()).search(text, dir ?? ".");
        return { matches, count: matches.length };
      },
    }),
    write({
      id: "workspace.write",
      title: "Write a file",
      summary:
        "Create or overwrite a file in the repository with the given content.",
      inputSchema: z.object({ path, content: z.string().max(400_000) }),
      run: async (input) => {
        const { path: file, content } = input as {
          path: string;
          content: string;
        };
        await (await workspace()).write(file, content);
        onChange?.();
        return { path: file, bytes: content.length };
      },
    }),
    write({
      id: "workspace.replace",
      title: "Edit a file",
      summary:
        "Replace one exact occurrence of `search` with `replacement` in a file. Fails if the text is missing or not unique.",
      inputSchema: z.object({
        path,
        search: z.string().min(1).max(50_000),
        replacement: z.string().max(200_000),
      }),
      run: async (input) => {
        const {
          path: file,
          search,
          replacement,
        } = input as {
          path: string;
          search: string;
          replacement: string;
        };
        const result = await (
          await workspace()
        ).replace(file, search, replacement);
        onChange?.();
        return result;
      },
    }),
    write(
      {
        id: "workspace.delete",
        title: "Delete a file",
        summary: "Delete one file from the repository.",
        inputSchema: z.object({ path }),
        run: async (input) => {
          await (await workspace()).remove((input as { path: string }).path);
          onChange?.();
          return { deleted: (input as { path: string }).path };
        },
      },
      "medium",
    ),
    write({
      id: "workspace.rename",
      title: "Rename a file",
      summary: "Move or rename a file inside the repository.",
      inputSchema: z.object({ from: path, to: path }),
      run: async (input) => {
        const { from, to } = input as { from: string; to: string };
        await (await workspace()).rename(from, to);
        onChange?.();
        return { from, to };
      },
    }),
    read({
      id: "workspace.diff",
      title: "Show the diff",
      summary:
        "The working-tree diff against the last commit, plus untracked files.",
      inputSchema: z.object({}),
      run: async () => (await workspace()).diff(),
    }),
    read({
      id: "workspace.commands",
      title: "List project commands",
      summary:
        "The install/format/lint/typecheck/test/build commands discovered from this repository's manifests.",
      inputSchema: z.object({}),
      run: async () => ({
        commands: commands().map((command) => ({
          id: command.id,
          phase: command.phase,
          command: [command.cmd, ...command.args].join(" "),
          source: command.source,
        })),
      }),
    }),
    write(
      {
        id: "workspace.run",
        title: "Run a command",
        summary:
          "Run a discovered project command by id (e.g. 'test'), or a development tool as {cmd, args}. Returns exit code, output tail and a failure analysis.",
        inputSchema: z
          .object({
            commandId: z.string().max(40).optional(),
            cmd: z.string().max(40).optional(),
            args: z.array(z.string().max(400)).max(30).optional(),
            cwd: path.optional(),
            timeoutSeconds: z.number().int().min(5).max(600).optional(),
          })
          .refine((value) => Boolean(value.commandId) !== Boolean(value.cmd), {
            message: "Give either commandId or cmd, not both.",
          }),
        run: async (input, context) => {
          const request = input as {
            commandId?: string;
            cmd?: string;
            args?: string[];
            cwd?: string;
            timeoutSeconds?: number;
          };
          let cmd: string;
          let args: string[];
          if (request.commandId) {
            const found = commands().find(
              (command) => command.id === request.commandId,
            );
            if (!found) throw new Error(`unknown_command:${request.commandId}`);
            cmd = found.cmd;
            args = found.args;
          } else {
            cmd = request.cmd!;
            args = request.args ?? [];
            const refusal = commandPermitted(cmd, args);
            if (refusal) throw new Error(refusal);
          }
          const ws = await workspace();
          const cwd = request.cwd
            ? `repo/${await ws.resolve(request.cwd)}`
            : undefined;
          const record = await ws.exec(cmd, args, {
            cwd,
            timeoutMs: (request.timeoutSeconds ?? 300) * 1000,
            signal: context.signal,
          });
          onChange?.();
          return {
            command: record.command,
            exitCode: record.exitCode,
            durationMs: record.durationMs,
            stdout: tail(record.stdout),
            stderr: tail(record.stderr),
            analysis: analyzeFailure(record),
          };
        },
      },
      "medium",
    ),
    read({
      id: "workspace.analyze_failure",
      title: "Analyse the last failure",
      summary:
        "Classify the most recent failed command (syntax, type, assertion, dependency, environment, …) and suggest a repair strategy.",
      inputSchema: z.object({}),
      run: async () => {
        const ws = await workspace();
        const failed = [...ws.log]
          .reverse()
          .find((record) => record.exitCode !== 0);
        if (!failed) return { failure: null, detail: "No failed command yet." };
        return { command: failed.command, analysis: analyzeFailure(failed) };
      },
    }),
  ];
}
