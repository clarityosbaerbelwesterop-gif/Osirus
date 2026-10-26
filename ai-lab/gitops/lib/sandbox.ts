/**
 * GitOps control plane — isolated execution of model-written code.
 *
 * Every candidate runs in a throwaway container with no network, a read-only
 * root and mount, no capabilities, no privilege escalation, an unprivileged
 * user, and hard memory/CPU/PID/time limits. The host directory holds only
 * the candidate's files and is deleted afterwards.
 */

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { SandboxSpec } from "./schema";

export interface SandboxResult {
  readonly exitCode: number | null;
  readonly timedOut: boolean;
  readonly stdout: string;
  readonly stderr: string;
}

export type ProcessRunner = (
  args: readonly string[],
  timeoutMs: number,
  containerName: string,
) => Promise<SandboxResult>;

const OUTPUT_CAP = 16 * 1024;
const FILE_NAME = /^[A-Za-z0-9_][\w.-]{0,63}$/;

export function dockerArgs(
  spec: SandboxSpec,
  hostDir: string,
  containerName: string,
  command: readonly string[],
): string[] {
  if (!path.isAbsolute(hostDir) || /[,:]/.test(hostDir))
    throw new Error("sandbox dir must be absolute without , or :");
  return [
    "run",
    "--rm",
    "--name",
    containerName,
    "--network",
    "none",
    "--read-only",
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges",
    "--pids-limit",
    String(spec.pidsLimit),
    "--memory",
    `${spec.memoryMb}m`,
    "--memory-swap",
    `${spec.memoryMb}m`,
    "--cpus",
    String(spec.cpus),
    "--user",
    "65534:65534",
    "--tmpfs",
    "/tmp:rw,noexec,nosuid,size=64m",
    "--env",
    "PYTHONDONTWRITEBYTECODE=1",
    "--env",
    "HOME=/tmp",
    "--volume",
    `${hostDir}:/work:ro`,
    "--workdir",
    "/work",
    spec.image,
    "timeout",
    "--kill-after=2",
    String(spec.timeoutSeconds),
    ...command,
  ];
}

export const dockerRunner: ProcessRunner = (args, timeoutMs, containerName) =>
  new Promise((resolve) => {
    const child = spawn("docker", [...args], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    child.stdout.on("data", (d: Buffer) => {
      if (stdout.length < OUTPUT_CAP) stdout += d.toString("utf8");
    });
    child.stderr.on("data", (d: Buffer) => {
      if (stderr.length < OUTPUT_CAP) stderr += d.toString("utf8");
    });
    const timer = setTimeout(() => {
      timedOut = true;
      spawn("docker", ["kill", containerName], { stdio: "ignore" });
    }, timeoutMs);
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({
        exitCode: null,
        timedOut,
        stdout,
        stderr: `${stderr}${error.message}`,
      });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      // coreutils `timeout` exits 124 when the inner limit fires.
      resolve({
        exitCode: code,
        timedOut: timedOut || code === 124 || code === 137,
        stdout,
        stderr,
      });
    });
  });

export async function runInSandbox(
  spec: SandboxSpec,
  files: Readonly<Record<string, string>>,
  command: readonly string[],
  runner: ProcessRunner = dockerRunner,
): Promise<SandboxResult> {
  const dir = mkdtempSync(path.join(tmpdir(), "gitops-sbx-"));
  try {
    chmodSync(dir, 0o755);
    for (const [name, content] of Object.entries(files)) {
      if (!FILE_NAME.test(name))
        throw new Error(`refusing sandbox file name ${JSON.stringify(name)}`);
      writeFileSync(path.join(dir, name), content, { mode: 0o644 });
    }
    const name = `gitops-sbx-${randomUUID()}`;
    // Outer guard: inner `timeout` + docker start-up; the container is killed past it.
    return await runner(
      dockerArgs(spec, dir, name, command),
      (spec.timeoutSeconds + 30) * 1000,
      name,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
