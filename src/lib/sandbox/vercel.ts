import "server-only";
import { Sandbox } from "@vercel/sandbox";
import type {
  CommandResult,
  SandboxAvailability,
  SandboxDriver,
  SandboxFile,
  SandboxHandle,
} from "./driver";

// Vercel Sandbox.
//
// Authentication is OIDC federation: inside a Vercel function the platform
// attaches an OIDC token to each request and the SDK exchanges it for sandbox
// credentials. No VERCEL_TOKEN is read here and none belongs in the app
// runtime -- a deployment token is a management credential, and the web
// process has no business holding one.
//
// The default network policy is deny-all. A sandbox that runs code written by
// a model, from an objective typed by a user, does not get outbound network
// access unless something explicitly asks for it and names the hosts.

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

export type SandboxCredentials = {
  token: string;
  teamId: string;
  projectId: string;
};

class VercelSandboxHandle implements SandboxHandle {
  constructor(private readonly sandbox: Sandbox) {}

  /** The sandbox's unique name within the project. */
  get sandboxId() {
    return this.sandbox.name;
  }

  async writeFiles(files: SandboxFile[]) {
    await this.sandbox.writeFiles(
      files.map((file) => ({
        path: file.path,
        content: Buffer.from(file.content, "utf8"),
      })),
    );
  }

  async readFile(path: string) {
    const buffer = await this.sandbox.readFileToBuffer({ path });
    return buffer ? buffer.toString("utf8") : null;
  }

  async listFiles(path: string) {
    const result = await this.runCommand({
      cmd: "ls",
      args: ["-1A", path],
      timeoutMs: 15_000,
    });
    if (result.exitCode !== 0) return [];
    return result.stdout.split("\n").filter(Boolean);
  }

  async runCommand(input: {
    cmd: string;
    args?: string[];
    cwd?: string;
    env?: Record<string, string>;
    timeoutMs?: number;
    signal?: AbortSignal;
  }): Promise<CommandResult> {
    const startedAt = Date.now();
    const printable = [input.cmd, ...(input.args ?? [])].join(" ");
    const finished = await this.sandbox.runCommand({
      cmd: input.cmd,
      args: input.args,
      cwd: input.cwd,
      env: input.env,
      timeoutMs: input.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      signal: input.signal,
    });
    const [stdout, stderr] = await Promise.all([
      finished.stdout(),
      finished.stderr(),
    ]);
    return {
      command: printable,
      exitCode: finished.exitCode,
      stdout,
      stderr,
      durationMs: finished.durationMs ?? Date.now() - startedAt,
    };
  }

  previewUrl(port: number) {
    try {
      return this.sandbox.domain(port);
    } catch {
      return null;
    }
  }

  async stop() {
    await this.sandbox.stop().catch(() => undefined);
  }

  async startBackground(input: { cmd: string; args?: string[]; cwd?: string }) {
    await this.sandbox.runCommand({
      cmd: input.cmd,
      args: input.args,
      cwd: input.cwd,
      detached: true,
    });
  }

  async keepAlive(ms: number) {
    await this.sandbox.extendTimeout(ms);
  }

  async snapshot() {
    const snapshot = await this.sandbox.snapshot();
    return { snapshotId: snapshot.snapshotId };
  }

  async destroy() {
    await this.sandbox.delete({ deleteOrphanSnapshots: true });
  }
}

/**
 * Reattach to a sandbox a previous stage created, by its name.
 *
 * A persistent sandbox that was stopped resumes from its last filesystem
 * state; one that was deleted, or never persistent and has timed out, is gone
 * and this returns null rather than a fresh empty VM under the old name.
 */
export async function reattachVercelSandbox(
  name: string,
  credentials?: SandboxCredentials,
): Promise<SandboxHandle | null> {
  try {
    const sandbox = await Sandbox.get({
      name,
      resume: true,
      ...(credentials ?? {}),
    } as never);
    return new VercelSandboxHandle(sandbox);
  } catch {
    return null;
  }
}

export class VercelSandboxDriver implements SandboxDriver {
  readonly id = "vercel";

  /**
   * Constructed only after resolveSandbox() has found either an OIDC token on
   * the request or explicit CI credentials, so it reports configured. Which
   * of the two authenticated it is recorded, because they are different
   * trust paths and the evidence should say which one ran.
   */
  constructor(private readonly credentials?: SandboxCredentials) {}

  availability(): SandboxAvailability {
    return {
      configured: true,
      driver: this.id,
      reason: this.credentials
        ? "Vercel Sandbox with CI-scoped credentials."
        : "Vercel Sandbox via OIDC federation.",
    };
  }

  async create(input: {
    name?: string;
    persistent?: boolean;
    ports?: number[];
    timeoutMs?: number;
    allowedDomains?: string[];
    signal?: AbortSignal;
  }): Promise<SandboxHandle> {
    const sandbox = await Sandbox.create({
      ...(this.credentials ?? {}),
      ...(input.name ? { name: input.name } : {}),
      ...(input.persistent ? { persistent: true } : {}),
      signal: input.signal,
      timeout: input.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      ports: input.ports,
      // "deny-all" is the default rather than a hardening option. A sandbox
      // running model-written code from a user-typed objective gets outbound
      // access only when a caller names the hosts it needs.
      networkPolicy: input.allowedDomains?.length
        ? { allow: input.allowedDomains }
        : "deny-all",
    });
    return new VercelSandboxHandle(sandbox);
  }

  reattach(name: string) {
    return reattachVercelSandbox(name, this.credentials);
  }
}
