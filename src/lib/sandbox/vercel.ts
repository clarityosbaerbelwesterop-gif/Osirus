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
// Authentication is OIDC federation: running inside a Vercel function, the
// platform provides VERCEL_OIDC_TOKEN and the SDK exchanges it for sandbox
// credentials. No VERCEL_TOKEN is read here and none belongs in the app
// runtime -- a deployment token is a management credential, and the web
// process has no business holding one.
//
// The default network policy is deny-all. A sandbox that runs code written by
// a model, from an objective typed by a user, does not get outbound network
// access unless something explicitly asks for it and names the hosts.

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

function oidcToken() {
  return process.env.VERCEL_OIDC_TOKEN;
}

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
    timeoutMs?: number;
    signal?: AbortSignal;
  }): Promise<CommandResult> {
    const startedAt = Date.now();
    const printable = [input.cmd, ...(input.args ?? [])].join(" ");
    const finished = await this.sandbox.runCommand({
      cmd: input.cmd,
      args: input.args,
      cwd: input.cwd,
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
}

export class VercelSandboxDriver implements SandboxDriver {
  readonly id = "vercel";

  availability(): SandboxAvailability {
    return oidcToken()
      ? {
          configured: true,
          driver: this.id,
          reason: "Vercel Sandbox via OIDC federation.",
        }
      : {
          configured: false,
          driver: null,
          reason:
            "VERCEL_OIDC_TOKEN is not present; sandboxes are only available inside a Vercel function.",
        };
  }

  async create(input: {
    ports?: number[];
    timeoutMs?: number;
    allowedDomains?: string[];
    signal?: AbortSignal;
  }): Promise<SandboxHandle> {
    const availability = this.availability();
    if (!availability.configured) {
      throw new Error(`sandbox_not_configured: ${availability.reason}`);
    }
    const sandbox = await Sandbox.create({
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
}
