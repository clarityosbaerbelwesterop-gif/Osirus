import type { DiscoveredCommand } from "./commands";
import type { RepositoryMap } from "./repo-map";
import type { CommandRecord } from "./workspace";

// What the database remembers about a coding workspace.
//
// The handle is the sandbox name the driver reattaches by -- an opaque string,
// never a credential. The rest is the last observed state, so the Files, Diff
// and Terminal tabs have something true to show after the VM is stopped.

export type WorkspaceStatus =
  "creating" | "ready" | "stopped" | "destroyed" | "failed";

export type WorkspaceRecord = {
  runId: string;
  driver: string;
  handle: string;
  status: WorkspaceStatus;
  repository: string | null;
  branch: string | null;
  repositoryMap: RepositoryMap | null;
  commands: DiscoveredCommand[];
  commandLog: CommandLogEntry[];
  fileTree: string[];
  diff: string | null;
  previewUrl: string | null;
  snapshotId: string | null;
};

/** A command as stored: command, exit code, duration and the output tail. */
export type CommandLogEntry = {
  command: string;
  cwd: string;
  exitCode: number | null;
  durationMs: number;
  at: string;
  stdoutTail: string;
  stderrTail: string;
};

export function toLogEntry(record: CommandRecord): CommandLogEntry {
  return {
    command: record.command.slice(0, 500),
    cwd: record.cwd,
    exitCode: record.exitCode,
    durationMs: record.durationMs,
    at: record.at,
    stdoutTail: record.stdout.slice(-4_000),
    stderrTail: record.stderr.slice(-4_000),
  };
}

export interface WorkspaceRecordStore {
  load(runId: string): Promise<WorkspaceRecord | null>;
  save(record: WorkspaceRecord): Promise<void>;
}

export class MemoryWorkspaceStore implements WorkspaceRecordStore {
  readonly records = new Map<string, WorkspaceRecord>();

  async load(runId: string) {
    return this.records.get(runId) ?? null;
  }

  async save(record: WorkspaceRecord) {
    this.records.set(record.runId, structuredClone(record));
  }
}

/** The sandbox name for a run: stable, so any later stage can reattach. */
export function workspaceName(runId: string) {
  return `osirus-${runId.replace(/[^a-z0-9-]/gi, "").toLowerCase()}`.slice(
    0,
    60,
  );
}
