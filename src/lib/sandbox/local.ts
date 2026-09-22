import { spawn } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
  lstat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import {
  isSafeRelativePath,
  type CommandResult,
  type SandboxAvailability,
  type SandboxDriver,
  type SandboxFile,
  type SandboxHandle,
} from "./driver";

// A workspace in a temporary directory, for tests and CI only.
//
// It exists so the coding and compute loops can be exercised end to end where
// Vercel Sandbox is not reachable -- in unit tests, and in the live-eval
// workflow, whose GitHub runner is itself an ephemeral, isolated VM. It is not
// a sandbox and does not pretend to be one: it refuses to construct inside a
// deployed Vercel function, and it is selected only when a caller asks for it
// by name.

export function localExecutionAllowed() {
  if (process.env.VERCEL) return false;
  return (
    process.env.NODE_ENV === "test" ||
    process.env.OSIRUS_ALLOW_LOCAL_EXEC === "1"
  );
}

const MAX_OUTPUT = 200_000;

class LocalWorkspaceHandle implements SandboxHandle {
  constructor(
    readonly sandboxId: string,
    private readonly root: string,
  ) {}

  /** Resolve a path inside the root, refusing traversal and symlink escape. */
  async resolveInside(relative: string, { mustExist = false } = {}) {
    if (!isSafeRelativePath(relative))
      throw new Error("path_outside_workspace");
    const target = resolve(this.root, relative);
    if (target !== this.root && !target.startsWith(this.root + sep)) {
      throw new Error("path_outside_workspace");
    }
    // Walk up to the deepest existing ancestor and check where it really is.
    let probe = target;
    while (true) {
      try {
        const real = await realpath(probe);
        if (real !== this.root && !real.startsWith(this.root + sep)) {
          throw new Error("path_escapes_through_symlink");
        }
        break;
      } catch (error) {
        if (
          error instanceof Error &&
          error.message === "path_escapes_through_symlink"
        )
          throw error;
        if (mustExist && probe === target) throw new Error("path_not_found");
        const parent = dirname(probe);
        if (parent === probe) break;
        probe = parent;
      }
    }
    return target;
  }

  async writeFiles(files: SandboxFile[]) {
    for (const file of files) {
      const target = await this.resolveInside(file.path);
      try {
        if ((await lstat(target)).isSymbolicLink())
          throw new Error("refusing_to_write_through_symlink");
      } catch (error) {
        if (
          error instanceof Error &&
          error.message === "refusing_to_write_through_symlink"
        )
          throw error;
      }
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, file.content, "utf8");
    }
  }

  async readFile(path: string) {
    try {
      return await readFile(
        await this.resolveInside(path, { mustExist: true }),
        "utf8",
      );
    } catch {
      return null;
    }
  }

  async listFiles(path: string) {
    try {
      return (
        await readdir(
          await this.resolveInside(path || ".", { mustExist: true }),
        )
      )
        .filter((name) => name !== ".git")
        .sort();
    } catch {
      return [];
    }
  }

  runCommand(input: {
    cmd: string;
    args?: string[];
    cwd?: string;
    timeoutMs?: number;
    signal?: AbortSignal;
  }): Promise<CommandResult> {
    const startedAt = Date.now();
    const printable = [input.cmd, ...(input.args ?? [])].join(" ");
    return new Promise((resolvePromise) => {
      void (async () => {
        const cwd = input.cwd ? await this.resolveInside(input.cwd) : this.root;
        // An argument array and no shell: nothing in an argument is ever
        // interpreted as shell syntax.
        const child = spawn(input.cmd, input.args ?? [], {
          cwd,
          shell: false,
          // Explicitly not inherited: tokens, database URLs, provider keys.
          env: {
            PATH: process.env.PATH ?? "",
            HOME: this.root,
            LANG: "C.UTF-8",
            CI: "1",
            NODE_ENV: "development",
          } as NodeJS.ProcessEnv,
          stdio: ["ignore", "pipe", "pipe"],
          signal: input.signal,
        });
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (chunk: Buffer) => {
          if (stdout.length < MAX_OUTPUT) stdout += chunk.toString();
        });
        child.stderr.on("data", (chunk: Buffer) => {
          if (stderr.length < MAX_OUTPUT) stderr += chunk.toString();
        });
        const timer = setTimeout(
          () => child.kill("SIGKILL"),
          input.timeoutMs ?? 120_000,
        );
        const finish = (exitCode: number | null) => {
          clearTimeout(timer);
          resolvePromise({
            command: printable,
            exitCode,
            stdout,
            stderr,
            durationMs: Date.now() - startedAt,
          });
        };
        child.on("error", (error) => {
          stderr += error.message;
          finish(null);
        });
        child.on("close", (code) => finish(code));
      })().catch((error: unknown) => {
        resolvePromise({
          command: printable,
          exitCode: null,
          stdout: "",
          stderr: error instanceof Error ? error.message : "command_failed",
          durationMs: Date.now() - startedAt,
        });
      });
    });
  }

  previewUrl() {
    return null;
  }

  async stop() {
    await rm(this.root, { recursive: true, force: true });
  }
}

export class LocalWorkspaceDriver implements SandboxDriver {
  readonly id = "local";

  availability(): SandboxAvailability {
    return localExecutionAllowed()
      ? {
          configured: true,
          driver: this.id,
          reason: "Local temporary workspace (tests and CI only).",
        }
      : {
          configured: false,
          driver: null,
          reason: "Local execution is disabled outside tests and CI.",
        };
  }

  async create(): Promise<SandboxHandle> {
    if (!localExecutionAllowed())
      throw new Error("local_execution_not_allowed");
    const root = await realpath(await mkdtemp(join(tmpdir(), "osirus-ws-")));
    return new LocalWorkspaceHandle(root.split(sep).pop()!, root);
  }
}
