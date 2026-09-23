import type { SandboxDriver } from "../sandbox/driver";
import {
  checkSequence,
  discoverCommands,
  type DiscoveredCommand,
} from "./commands";
import { analyzeFailure, type FailureAnalysis } from "./failure";
import { buildRepositoryMap } from "./repo-map";
import {
  toLogEntry,
  workspaceName,
  type WorkspaceRecord,
  type WorkspaceRecordStore,
} from "./store";
import {
  cloneRepository,
  CodingWorkspace,
  initRepository,
  REPO_DIR,
} from "./workspace";

// A coding workspace across stages.
//
// Opening creates (or reattaches to) a persistent sandbox named after the run,
// clones or initialises the repository, maps it and discovers its commands,
// and writes the record. Every later stage reattaches by that name. Nothing
// here decides what to change -- that is the agent loop -- it owns the
// lifecycle and the evidence: the command log, the diff, the file tree.

export const PREVIEW_PORT = 4173;

/** Hosts a workspace may reach: package registries and GitHub, nothing else. */
export const WORKSPACE_ALLOWED_DOMAINS = [
  "registry.npmjs.org",
  "pypi.org",
  "files.pythonhosted.org",
  "github.com",
  "codeload.github.com",
  "objects.githubusercontent.com",
  "crates.io",
  "static.crates.io",
  "index.crates.io",
  "proxy.golang.org",
  "sum.golang.org",
];

export { repositoryInObjective } from "./repository-ref";

export type CheckRun = {
  phase: DiscoveredCommand["phase"];
  command: string;
  source: string;
  exitCode: number | null;
  durationMs: number;
  stdout: string;
  stderr: string;
  analysis: FailureAnalysis | null;
};

export class WorkspaceSession {
  /** How much of the workspace's command log is already in the record. */
  private loggedUpTo = 0;

  private constructor(
    readonly workspace: CodingWorkspace,
    readonly record: WorkspaceRecord,
    private readonly store: WorkspaceRecordStore,
  ) {}

  get commands() {
    return this.record.commands;
  }

  /** Wrap an already reattached handle and its stored record. */
  static async attach(
    handle: import("../sandbox/driver").SandboxHandle,
    record: WorkspaceRecord,
    store: WorkspaceRecordStore,
  ) {
    const session = new WorkspaceSession(
      new CodingWorkspace(handle),
      { ...record, status: "ready" },
      store,
    );
    await store.save(session.record);
    return session;
  }

  /**
   * Create the workspace for a run, or reattach to the one that exists.
   *
   * A record whose sandbox is gone (deleted, expired, never persisted) is
   * reported as such -- the caller decides whether to recreate -- rather than
   * silently replaced by an empty VM that looks like the old one.
   */
  static async open(input: {
    driver: SandboxDriver;
    store: WorkspaceRecordStore;
    runId: string;
    repository?: string | null;
    branch?: string | null;
    readToken?: string | null;
    fixture?: Array<{ path: string; content: string }>;
    install?: boolean;
    signal?: AbortSignal;
  }): Promise<{ session: WorkspaceSession; created: boolean }> {
    const existing = await input.store.load(input.runId);
    const secrets = input.readToken ? [input.readToken] : [];
    if (existing && existing.status !== "destroyed" && input.driver.reattach) {
      const handle = await input.driver.reattach(existing.handle);
      if (handle) {
        const session = new WorkspaceSession(
          new CodingWorkspace(handle, secrets),
          { ...existing, status: "ready" },
          input.store,
        );
        await input.store.save(session.record);
        return { session, created: false };
      }
    }

    const name = workspaceName(input.runId);
    const handle = await input.driver.create({
      name,
      persistent: true,
      ports: [PREVIEW_PORT],
      timeoutMs: 30 * 60 * 1000,
      allowedDomains: WORKSPACE_ALLOWED_DOMAINS,
      signal: input.signal,
    });
    const workspace = new CodingWorkspace(handle, secrets);
    const record: WorkspaceRecord = {
      runId: input.runId,
      driver: input.driver.id,
      handle: handle.sandboxId,
      status: "creating",
      repository: input.repository ?? null,
      branch: input.branch ?? null,
      repositoryMap: null,
      commands: [],
      commandLog: [],
      fileTree: [],
      diff: null,
      previewUrl: null,
      snapshotId: null,
    };
    await input.store.save(record);
    const session = new WorkspaceSession(workspace, record, input.store);

    try {
      if (input.repository) {
        const clone = await cloneRepository(workspace, {
          url: input.repository,
          branch: input.branch ?? undefined,
          token: input.readToken ?? undefined,
        });
        if (clone.exitCode !== 0)
          throw new Error(`clone_failed:${clone.stderr.slice(-200)}`);
      } else {
        await initRepository(workspace, input.fixture ?? []);
      }
      const head = await workspace.exec(
        "git",
        ["rev-parse", "--abbrev-ref", "HEAD"],
        { record: false },
      );
      record.branch ??= head.exitCode === 0 ? head.stdout.trim() || null : null;
      const { map, contents, files } = await buildRepositoryMap(workspace);
      record.repositoryMap = map;
      record.commands = discoverCommands(map, contents, files);
      record.status = "ready";
      if (input.install !== false) {
        const install = record.commands.find(
          (command) => command.phase === "install",
        );
        if (install)
          await workspace.exec(install.cmd, install.args, {
            timeoutMs: 600_000,
            signal: input.signal,
          });
      }
      await session.refresh();
    } catch (error) {
      record.status = "failed";
      record.commandLog = workspace.log.map(toLogEntry);
      await input.store.save(record);
      throw error;
    }
    return { session, created: true };
  }

  /** Re-read tree, diff and command log into the record and persist it. */
  async refresh() {
    const [tree, diff] = await Promise.all([
      this.workspace.tree(".", 6).catch(() => this.record.fileTree),
      this.workspace.diff().catch(() => null),
    ]);
    this.record.fileTree = tree;
    if (diff) {
      const untracked = diff.untracked.length
        ? `\n# Untracked files\n${diff.untracked.map((file) => `+ ${file}`).join("\n")}\n`
        : "";
      this.record.diff = `${diff.patch}${untracked}`.slice(0, 400_000) || null;
    }
    this.record.commandLog = [
      ...this.record.commandLog,
      ...this.workspace.log.slice(this.loggedUpTo).map(toLogEntry),
    ].slice(-60);
    this.loggedUpTo = this.workspace.log.length;
    this.record.previewUrl =
      this.workspace.handle.previewUrl(PREVIEW_PORT) ?? this.record.previewUrl;
    await this.store.save(this.record);
  }

  /**
   * Run the repository's own checks in order and keep every result.
   *
   * Stops at the first failing phase: a type error makes the test run's
   * failures noise. The phases not reached are simply absent from the result,
   * and the verifier treats absent as not run.
   */
  async runChecks(signal?: AbortSignal): Promise<CheckRun[]> {
    const runs: CheckRun[] = [];
    for (const command of checkSequence(this.record.commands)) {
      const record = await this.workspace.exec(command.cmd, command.args, {
        timeoutMs: 600_000,
        signal,
      });
      runs.push({
        phase: command.phase,
        command: record.command,
        source: command.source,
        exitCode: record.exitCode,
        durationMs: record.durationMs,
        stdout: record.stdout.slice(-4_000),
        stderr: record.stderr.slice(-4_000),
        analysis: analyzeFailure(record),
      });
      if (record.exitCode !== 0) break;
    }
    await this.refresh();
    return runs;
  }

  /** Persist the final state and stop the VM; a persistent sandbox keeps its files. */
  async finalize({ snapshot = false } = {}) {
    await this.refresh();
    if (snapshot && this.workspace.handle.snapshot) {
      const { snapshotId } = await this.workspace.handle.snapshot();
      this.record.snapshotId = snapshotId;
    } else {
      await this.workspace.handle.stop();
    }
    this.record.status = "stopped";
    await this.store.save(this.record);
  }

  async destroy() {
    await this.workspace.handle.destroy?.();
    this.record.status = "destroyed";
    await this.store.save(this.record);
  }
}

export { REPO_DIR };
