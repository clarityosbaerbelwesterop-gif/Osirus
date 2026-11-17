import {
  canonicalGithubCloneUrl,
  cloneBranch,
  cloneDepth,
} from "./clone-target";
import {
  isSafeRelativePath,
  type CommandResult,
  type SandboxHandle,
} from "../sandbox/driver";

// A repository the agent works in.
//
// Everything goes through the sandbox handle, so the same code drives Vercel
// Sandbox in production and the temporary-directory adapter in tests and CI.
// Paths are checked twice: syntactically here, and against the real
// filesystem inside the sandbox with realpath, so a symlink planted in a
// repository cannot turn a write under src/ into a write anywhere else.

export const REPO_DIR = "repo";

const SECRET_ENV_NAMES = ["GIT_TOKEN", "GITHUB_TOKEN", "GH_TOKEN"];

export type CommandRecord = CommandResult & { cwd: string; at: string };

/**
 * Dependency installs run in the background (they took 60-90 s and held the
 * whole answer back). Markers live next to the repository, never in it, so
 * they show up in no diff.
 */
const INSTALL_DIR = "../.osirus-install";
const INSTALL_TIMEOUT_S = 600;
/** Commands that read the tree and never need installed dependencies. */
const NEEDS_NO_INSTALL = new Set([
  "git",
  "ls",
  "cat",
  "head",
  "tail",
  "wc",
  "grep",
  "rg",
  "find",
  "pwd",
  "realpath",
  "stat",
  "test",
  "echo",
]);

/** POSIX single-quote a word for sh -c. */
export function shellQuote(word: string) {
  return `'${word.replace(/'/g, `'\\''`)}'`;
}

export class CodingWorkspace {
  /** Every command run, in order: the Terminal tab and the evidence for tests. */
  readonly log: CommandRecord[] = [];
  private rootAbsolute: string | null = null;
  /** True once no background install can still be running. */
  private installSettled = false;

  constructor(
    readonly handle: SandboxHandle,
    private readonly secrets: string[] = [],
  ) {}

  get id() {
    return this.handle.sandboxId;
  }

  /** Register a credential so every later record redacts it. */
  addSecret(secret: string) {
    if (secret.length >= 8 && !this.secrets.includes(secret))
      this.secrets.push(secret);
  }

  /** Redact anything that looks like, or is, a credential from command output. */
  redact(text: string) {
    let out = text;
    for (const secret of this.secrets)
      if (secret.length >= 8) out = out.split(secret).join("[REDACTED]");
    return out
      .replace(
        /(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/g,
        "[REDACTED]",
      )
      .replace(/(https?:\/\/)[^/\s:@]+:[^/\s@]+@/g, "$1[REDACTED]@");
  }

  async exec(
    cmd: string,
    args: string[] = [],
    options: {
      cwd?: string;
      timeoutMs?: number;
      env?: Record<string, string>;
      signal?: AbortSignal;
      record?: boolean;
    } = {},
  ): Promise<CommandRecord> {
    const cwd = options.cwd ?? REPO_DIR;
    if (!isSafeRelativePath(cwd)) throw new Error("cwd_outside_workspace");
    if (!NEEDS_NO_INSTALL.has(cmd)) await this.awaitInstall(options.signal);
    const result = await this.handle.runCommand({
      cmd,
      args,
      cwd,
      env: options.env,
      timeoutMs: options.timeoutMs ?? 180_000,
      signal: options.signal,
    });
    const record: CommandRecord = {
      ...result,
      command: this.redact(result.command),
      stdout: this.redact(result.stdout).slice(-20_000),
      stderr: this.redact(result.stderr).slice(-20_000),
      cwd,
      at: new Date().toISOString(),
    };
    if (options.record !== false) this.log.push(record);
    return record;
  }

  /**
   * Start the dependency install without waiting for it. Returns false when
   * the driver cannot run a background process; the caller installs inline.
   */
  async startInstall(cmd: string, args: string[]) {
    if (!this.handle.startBackground) return false;
    const command = [cmd, ...args].map(shellQuote).join(" ");
    // The marker is set before the background process starts, so a command
    // issued a moment later can never miss a running install.
    await this.handle.runCommand({
      cmd: "sh",
      args: [
        "-c",
        `mkdir -p ${INSTALL_DIR} && rm -f ${INSTALL_DIR}/exit ${INSTALL_DIR}/log && touch ${INSTALL_DIR}/started`,
      ],
      cwd: REPO_DIR,
      timeoutMs: 15_000,
    });
    await this.handle.startBackground({
      cmd: "sh",
      args: [
        "-c",
        `timeout ${INSTALL_TIMEOUT_S} ${command} > ${INSTALL_DIR}/log 2>&1; echo $? > ${INSTALL_DIR}/exit`,
      ],
      cwd: REPO_DIR,
    });
    this.installSettled = false;
    return true;
  }

  /**
   * Wait for a background install before a command that may need its
   * dependencies. One check per workspace object; the install's own output
   * lands in the log like any other command.
   */
  async awaitInstall(signal?: AbortSignal) {
    if (this.installSettled) return;
    const started = Date.now();
    const result = await this.handle.runCommand({
      cmd: "sh",
      args: [
        "-c",
        `[ -f ${INSTALL_DIR}/started ] || { echo none; exit 0; }; ` +
          `i=0; while [ ! -f ${INSTALL_DIR}/exit ] && [ $i -lt ${INSTALL_TIMEOUT_S + 30} ]; do sleep 1; i=$((i+1)); done; ` +
          `echo "exit=$(cat ${INSTALL_DIR}/exit 2>/dev/null || echo timeout)"; tail -c 4000 ${INSTALL_DIR}/log 2>/dev/null; ` +
          // Reported once: a reattached workspace does not log it again.
          `[ -f ${INSTALL_DIR}/exit ] && rm -f ${INSTALL_DIR}/started; true`,
      ],
      cwd: REPO_DIR,
      timeoutMs: (INSTALL_TIMEOUT_S + 60) * 1000,
      signal,
    });
    this.installSettled = true;
    const output = result.stdout ?? "";
    if (result.exitCode !== 0 || output.startsWith("none")) return;
    const exit = /^exit=(\d+)/.exec(output)?.[1];
    this.log.push({
      command: "dependency install (background)",
      exitCode: exit === undefined ? null : Number(exit),
      stdout: this.redact(output.replace(/^exit=\S+\n?/, "")).slice(-20_000),
      stderr: "",
      durationMs: Date.now() - started,
      cwd: REPO_DIR,
      at: new Date().toISOString(),
    } as CommandRecord);
  }

  private async root() {
    if (this.rootAbsolute) return this.rootAbsolute;
    const result = await this.handle.runCommand({
      cmd: "pwd",
      args: [],
      cwd: REPO_DIR,
      timeoutMs: 10_000,
    });
    const root = result.stdout.trim();
    if (result.exitCode !== 0 || !root.startsWith("/"))
      throw new Error("workspace_root_unavailable");
    this.rootAbsolute = root;
    return root;
  }

  /** Resolve a repository-relative path, refusing traversal and symlink escape. */
  async resolve(path: string) {
    const relative = path.replace(/^\.\/+/, "") || ".";
    if (relative !== "." && !isSafeRelativePath(relative))
      throw new Error("path_outside_repository");
    const root = await this.root();
    const result = await this.handle.runCommand({
      cmd: "realpath",
      args: ["-m", "--", relative],
      cwd: REPO_DIR,
      timeoutMs: 10_000,
    });
    const real = result.stdout.trim();
    if (
      result.exitCode !== 0 ||
      (real !== root && !real.startsWith(`${root}/`))
    ) {
      throw new Error("path_escapes_repository");
    }
    // A symlink into .git resolves inside the root, so check the real path too.
    if (real !== root && !isSafeRelativePath(real.slice(root.length + 1)))
      throw new Error("path_outside_repository");
    return relative;
  }

  async read(path: string, maxBytes = 200_000) {
    const relative = await this.resolve(path);
    const result = await this.exec(
      "head",
      ["-c", String(maxBytes), "--", relative],
      { record: false },
    );
    if (result.exitCode !== 0)
      throw new Error(`read_failed:${result.stderr.slice(0, 120)}`);
    if (result.stdout.includes("\u0000")) throw new Error("binary_file");
    return result.stdout;
  }

  async write(path: string, content: string) {
    const relative = await this.resolve(path);
    // A symlink at the target itself is refused outright: writing through it
    // is exactly the escape the realpath check exists to stop.
    const link = await this.exec("test", ["-L", relative], { record: false });
    if (link.exitCode === 0)
      throw new Error("refusing_to_write_through_symlink");
    await this.handle.writeFiles([
      { path: `${REPO_DIR}/${relative}`, content },
    ]);
  }

  /** Exact search-and-replace. Fails unless the search text occurs exactly once. */
  async replace(path: string, search: string, replacement: string) {
    const content = await this.read(path, 2_000_000);
    const first = content.indexOf(search);
    if (first < 0) throw new Error("search_text_not_found");
    if (content.indexOf(search, first + search.length) >= 0)
      throw new Error("search_text_not_unique");
    await this.write(
      path,
      content.slice(0, first) +
        replacement +
        content.slice(first + search.length),
    );
    return { path, replacedAt: first };
  }

  async remove(path: string) {
    const relative = await this.resolve(path);
    const result = await this.exec("rm", ["-f", "--", relative]);
    if (result.exitCode !== 0) throw new Error("delete_failed");
  }

  async rename(from: string, to: string) {
    const source = await this.resolve(from);
    const target = await this.resolve(to);
    const result = await this.exec("mv", ["--", source, target]);
    if (result.exitCode !== 0) throw new Error("rename_failed");
  }

  async tree(path = ".", depth = 3, { filesOnly = false } = {}) {
    const relative = await this.resolve(path);
    const result = await this.exec(
      "find",
      [
        relative,
        "-maxdepth",
        String(Math.min(Math.max(depth, 1), 8)),
        ...(filesOnly ? ["-type", "f"] : []),
        "-not",
        "-path",
        "*/.git/*",
        "-not",
        "-path",
        "*/node_modules/*",
        "-not",
        "-name",
        ".git",
      ],
      { record: false },
    );
    return result.stdout
      .split("\n")
      .map((line) => line.replace(/^\.\//, ""))
      .filter((line) => line && line !== ".")
      .sort()
      .slice(0, 800);
  }

  async search(pattern: string, path = ".") {
    const relative = await this.resolve(path);
    // Fixed-string search: the pattern is never interpreted as a regex, so a
    // model-written pattern cannot become a catastrophic backtracking case.
    const result = await this.exec(
      "grep",
      [
        "-rnIF",
        "--exclude-dir=.git",
        "--exclude-dir=node_modules",
        "-m",
        "20",
        "--",
        pattern,
        relative,
      ],
      { record: false },
    );
    return result.stdout.split("\n").filter(Boolean).slice(0, 200);
  }

  async gitStatus() {
    return (
      await this.exec("git", ["status", "--porcelain=v1"], { record: false })
    ).stdout;
  }

  async diff() {
    const stat = await this.exec("git", ["--no-pager", "diff", "--stat"], {
      record: false,
    });
    const patch = await this.exec("git", ["--no-pager", "diff", "--no-color"], {
      record: false,
    });
    const untracked = await this.exec(
      "git",
      ["ls-files", "--others", "--exclude-standard"],
      { record: false },
    );
    return {
      stat: stat.stdout,
      patch: patch.stdout.slice(0, 200_000),
      untracked: untracked.stdout.split("\n").filter(Boolean),
    };
  }

  async fileExists(path: string) {
    try {
      const relative = await this.resolve(path);
      return (
        (await this.exec("test", ["-f", relative], { record: false }))
          .exitCode === 0
      );
    } catch {
      return false;
    }
  }

  static secretEnvNames() {
    return SECRET_ENV_NAMES;
  }
}

/**
 * Clone into the workspace. Public repositories need nothing; a private one
 * gets a token through the environment of this single command, read by a
 * credential helper, so it never appears in an argument, a log line or the
 * repository's config.
 */
export async function cloneRepository(
  workspace: CodingWorkspace,
  input: { url: string; branch?: string; token?: string; depth?: number },
) {
  const url = canonicalGithubCloneUrl(input.url);
  const branch = cloneBranch(input.branch);
  const args = [
    "-c",
    "credential.helper=",
    ...(input.token
      ? [
          "-c",
          "credential.helper=!f() { echo username=x-access-token; echo password=$GIT_TOKEN; }; f",
        ]
      : []),
    "clone",
    "--depth",
    cloneDepth(input.depth),
    ...(branch ? ["--branch", branch] : []),
    "--",
    url,
    REPO_DIR,
  ];
  return workspace.exec("git", args, {
    cwd: ".",
    timeoutMs: 180_000,
    env: input.token ? { GIT_TOKEN: input.token } : undefined,
  });
}

/** Initialise a repository from files, for fixtures and scratch work. */
export async function initRepository(
  workspace: CodingWorkspace,
  files: Array<{ path: string; content: string }>,
) {
  await workspace.exec("mkdir", ["-p", REPO_DIR], { cwd: ".", record: false });
  await workspace.handle.writeFiles(
    files.map((file) => ({
      path: `${REPO_DIR}/${file.path}`,
      content: file.content,
    })),
  );
  await workspace.exec("git", ["init", "-q", "-b", "main"]);
  await workspace.exec("git", [
    "-c",
    "user.email=agent@osirus.local",
    "-c",
    "user.name=Osirus",
    "add",
    "-A",
  ]);
  await workspace.exec("git", [
    "-c",
    "user.email=agent@osirus.local",
    "-c",
    "user.name=Osirus",
    "commit",
    "-q",
    "--allow-empty",
    "-m",
    "initial state",
  ]);
}
