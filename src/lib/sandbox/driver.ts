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

export interface SandboxHandle {
  readonly sandboxId: string;
  writeFiles(files: SandboxFile[]): Promise<void>;
  readFile(path: string): Promise<string | null>;
  listFiles(path: string): Promise<string[]>;
  runCommand(input: {
    cmd: string;
    args?: string[];
    cwd?: string;
    timeoutMs?: number;
    signal?: AbortSignal;
  }): Promise<CommandResult>;
  /** The public URL of an exposed port, or null when none is exposed. */
  previewUrl(port: number): string | null;
  stop(): Promise<void>;
}

export interface SandboxDriver {
  readonly id: string;
  availability(): SandboxAvailability;
  create(input: {
    /** Ports to expose for a preview. Keep this empty unless one is needed. */
    ports?: number[];
    timeoutMs?: number;
    /** Hosts the sandbox may reach. Everything else is denied. */
    allowedDomains?: string[];
    signal?: AbortSignal;
  }): Promise<SandboxHandle>;
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
