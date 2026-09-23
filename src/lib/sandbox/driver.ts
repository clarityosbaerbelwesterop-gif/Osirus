// The sandbox boundary.
//
// Generated code never runs inside the production web process. It runs in an
// isolated VM with its own filesystem and its own network policy, and this
// interface is the only way the runtime talks to it.
//
// Availability is reported honestly. When no sandbox is configured the status
// is NOT_CONFIGURED and every command comes back with a null exit code, which
// the verification engine reads as "inconclusive" -- so a coding result that
// nobody could run is reported as unverified rather than as working.

export type SandboxAvailability =
  | { configured: true; driver: string; reason: string }
  | { configured: false; driver: null; reason: string };

export type CommandResult = {
  command: string;
  /** Null when the command did not run to completion, or did not run at all. */
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
};

export type SandboxFile = { path: string; content: string };

/**
 * Whether a path stays inside the sandbox working directory.
 *
 * Shared rather than duplicated because both callers reach the same
 * writeFiles: the sandbox tool, where an arm names the path, and the coding
 * arm's check stage, where the path is parsed out of model output. The second
 * is the one that matters -- a file path in generated text is attacker-
 * influenced whenever the objective is.
 */
export function isSafeRelativePath(value: string) {
  if (value.length === 0 || value.length > 400) return false;
  if (value.startsWith("/") || /^[a-zA-Z]:/.test(value)) return false;
  if (value.includes("\\0")) return false;
  return !value.split("/").includes("..");
}

export interface SandboxHandle {
  readonly sandboxId: string;
  writeFiles(files: SandboxFile[]): Promise<void>;
  readFile(path: string): Promise<string | null>;
  listFiles(path: string): Promise<string[]>;
  runCommand(input: {
    cmd: string;
    args?: string[];
    cwd?: string;
    /** Extra environment for this command only. Values are never logged. */
    env?: Record<string, string>;
    timeoutMs?: number;
    signal?: AbortSignal;
  }): Promise<CommandResult>;
  /** The public URL of an exposed port, or null when none is exposed. */
  previewUrl(port: number): string | null;
  /** Stop the VM. A persistent workspace keeps its filesystem for resume. */
  stop(): Promise<void>;
  /** Push the idle deadline out. Absent where the driver has no deadline. */
  keepAlive?(ms: number): Promise<void>;
  /** Freeze the filesystem as a restorable snapshot; stops the VM. */
  snapshot?(): Promise<{ snapshotId: string }>;
  /** Delete the workspace and everything in it. Not recoverable. */
  destroy?(): Promise<void>;
}

export interface SandboxDriver {
  readonly id: string;
  availability(): SandboxAvailability;
  create(input: {
    /**
     * A stable name, so a later request can reattach to the same workspace.
     * Omitted for throwaway sandboxes.
     */
    name?: string;
    /** Keep the filesystem across stop and resume. */
    persistent?: boolean;
    /** Ports to expose for a preview. Keep this empty unless one is needed. */
    ports?: number[];
    timeoutMs?: number;
    /** Hosts the sandbox may reach. Everything else is denied. */
    allowedDomains?: string[];
    signal?: AbortSignal;
  }): Promise<SandboxHandle>;
  /** Reattach to a named workspace, or null when it no longer exists. */
  reattach?(name: string): Promise<SandboxHandle | null>;
}

/**
 * The driver used when nothing is configured.
 *
 * It does not pretend. Commands return a null exit code and say so, writes
 * throw, and availability reports why. Returning a zero exit code here would
 * turn "we could not run your tests" into "your tests passed".
 */
export class UnconfiguredSandbox implements SandboxDriver {
  readonly id = "none";

  constructor(private readonly reason: string) {}

  availability(): SandboxAvailability {
    return { configured: false, driver: null, reason: this.reason };
  }

  async create(): Promise<SandboxHandle> {
    throw new Error(`sandbox_not_configured: ${this.reason}`);
  }
}

export function unavailableResult(
  command: string,
  reason: string,
): CommandResult {
  return {
    command,
    exitCode: null,
    stdout: "",
    stderr: `NOT_CONFIGURED: ${reason}`,
    durationMs: 0,
  };
}
