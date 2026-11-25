import "server-only";
import type { ProductIdentity } from "../auth/bootstrap";
import type { GatewayModel } from "../gateway/models";
import { PROVIDER_WIDE_CODES } from "../gateway/routing";
import { completeGateway } from "../gateway/stream";
import { estimateTokens, recordGatewayCall } from "../gateway/usage";
import type { SandboxDriver, SandboxHandle } from "../sandbox/driver";
import { sandboxErrorSummary } from "../sandbox/error-summary";
import {
  COMPUTER_FILES_MAX_BYTES,
  type ComputerFiles,
} from "./bot-computer-files";
import {
  COMPUTER_ALLOWED_DOMAINS,
  COMPUTER_BUDGET_MS,
  COMPUTER_COMMAND_SECONDS,
  COMPUTER_MAX_STEPS,
  computerName,
  computerPlanMessages,
  parseComputerStep,
  stepCommand,
  type ComputerStep,
} from "./bot-computer-plan";

// Every bot's own cloud computer: a persistent, named Vercel Sandbox per
// bot and workspace. It resumes with its files on each use and is stopped
// (filesystem kept) when the answer is done.

const MACHINE_TIMEOUT_MS = 10 * 60 * 1000;
// Models asked per planning step, at most. A provider that is rate limited
// (or out of credit) is skipped for the rest of the step: production
// 2026-11-25, both candidates were free models of one provider, both rate
// limited, and the bot answered without its computer.
const PLAN_MODELS = 5;

export type ComputerPlanner = (steps: ComputerStep[]) => Promise<{
  command: string;
  reason: string;
} | null>;

/** Planner backed by the bot's models; any failure means "no command". */
export function modelPlanner(input: {
  identity: ProductIdentity;
  sessionId: string;
  models: GatewayModel[];
  botName: string;
  message: string;
  signal?: AbortSignal;
}): ComputerPlanner {
  return async (steps) => {
    const messages = computerPlanMessages({
      botName: input.botName,
      message: input.message,
      steps,
    });
    const skipped = new Set<string>();
    for (const model of input.models.slice(0, PLAN_MODELS)) {
      if (input.signal?.aborted) return null;
      if (skipped.has(model.provider)) continue;
      const started = Date.now();
      try {
        const result = await completeGateway({
          ref: model.ref,
          messages,
          maxTokens: 900,
          temperature: 0,
          signal: input.signal
            ? AbortSignal.any([input.signal, AbortSignal.timeout(20_000)])
            : AbortSignal.timeout(20_000),
        });
        await recordGatewayCall({
          identity: input.identity,
          model,
          surface: "ai",
          sessionId: input.sessionId,
          status: "completed",
          usage: {
            ...result.usage,
            inputTokens:
              result.usage.inputTokens ??
              estimateTokens(messages.map((entry) => entry.content).join("\n")),
            outputTokens:
              result.usage.outputTokens ?? estimateTokens(result.text),
          },
          latencyMs: Date.now() - started,
        }).catch(() => undefined);
        const next = parseComputerStep(result.text);
        if (next) {
          logPlan(model.ref, "command");
          return next;
        }
        // A clear "no command" is the planner's answer; anything else (prose,
        // broken JSON) is a planner that did not follow the format, so the
        // next model gets the question.
        if (declinesComputer(result.text)) {
          logPlan(model.ref, "declined");
          return null;
        }
        logPlan(model.ref, "unparsable");
      } catch (error) {
        const code = (error as { code?: unknown } | null)?.code;
        if (typeof code === "string" && PROVIDER_WIDE_CODES.has(code))
          skipped.add(model.provider);
        logPlan(model.ref, "error", code ?? "provider_error");
      }
    }
    return null;
  };
}

/** The planner said in its own format that no command is needed. */
export function declinesComputer(text: string) {
  return /"command"\s*:\s*null/.test(text);
}

/** Operator log: which model planned and how it answered (no content). */
function logPlan(model: string, outcome: string, code?: unknown) {
  console.info(
    JSON.stringify({
      event: "bot.computer.plan",
      model,
      outcome,
      ...(typeof code === "string" ? { code } : {}),
    }),
  );
}

/**
 * The bot's machine: the running one when there is one, else a fresh one
 * with the bot's working folder unpacked into it. Machines are not
 * persistent: Osirus keeps the folder itself (bot-computer-files.ts), not
 * a ~845 MB VM snapshot per bot.
 */
export async function openComputer(
  driver: SandboxDriver,
  name: string,
  signal?: AbortSignal,
  files?: ComputerFiles,
): Promise<SandboxHandle> {
  const found = driver.reattach
    ? await driver.reattach(name).catch(() => null)
    : null;
  // A machine deleted a moment ago (the end of a chat answer) can still be
  // found under its name; the probe tells, and a fresh one takes its place.
  const existing =
    found &&
    (await found.readFile(RESTORED_MARK).then(
      () => true,
      (error: unknown) => !machineGone(error),
    ))
      ? found
      : null;
  const machine =
    existing ??
    (await driver.create({
      name,
      timeoutMs: MACHINE_TIMEOUT_MS,
      allowedDomains: COMPUTER_ALLOWED_DOMAINS,
      signal,
    }));
  if (files) await restoreFolder(machine, files, signal);
  return machine;
}

const RESTORED_MARK = ".osirus/restored";

/** The sandbox no longer exists (deleted or expired). */
export function machineGone(error: unknown) {
  const summary = sandboxErrorSummary(error);
  return (
    summary.status === 404 ||
    summary.code === "not_found" ||
    /sandbox not found/i.test(summary.message ?? "")
  );
}
const ARCHIVE_IN = ".osirus/restore.b64";
const ARCHIVE_OUT = ".osirus/save.tgz";

/** Unpack the kept folder into a machine that does not have it yet. */
export async function restoreFolder(
  machine: SandboxHandle,
  files: ComputerFiles,
  signal?: AbortSignal,
) {
  if (await machine.readFile(RESTORED_MARK).catch(() => null)) return;
  const archive = await files.load().catch(() => null);
  if (archive) {
    await machine.writeFiles([{ path: ARCHIVE_IN, content: archive }]);
    await machine.runCommand({
      cmd: "bash",
      args: [
        "-c",
        `mkdir -p work && base64 -d ${ARCHIVE_IN} | tar xzf - -C work; rm -f ${ARCHIVE_IN}`,
      ],
      timeoutMs: 60_000,
      signal,
    });
  }
  await machine.writeFiles([{ path: RESTORED_MARK, content: "1\n" }]);
}

/** Pack the working folder and keep it; false when it was not kept. */
export async function saveFolder(machine: SandboxHandle, files: ComputerFiles) {
  const packed = await machine.runCommand({
    cmd: "bash",
    args: [
      "-c",
      `mkdir -p work .osirus && tar czf ${ARCHIVE_OUT} -C work . && stat -c %s ${ARCHIVE_OUT}`,
    ],
    timeoutMs: 60_000,
  });
  const size = Number(packed.stdout.trim().split("\n").at(-1));
  if (packed.exitCode !== 0 || !Number.isFinite(size)) return false;
  if (size > COMPUTER_FILES_MAX_BYTES) {
    console.warn(
      JSON.stringify({
        event: "bot.computer.files",
        outcome: "too_large",
        size,
      }),
    );
    return false;
  }
  const encoded = await machine.runCommand({
    cmd: "bash",
    args: ["-c", `base64 -w0 ${ARCHIVE_OUT} && rm -f ${ARCHIVE_OUT}`],
    timeoutMs: 60_000,
  });
  if (encoded.exitCode !== 0) return false;
  return files.save(encoded.stdout.trim());
}

/** Run one step: the script goes in as a file, never into the shell line. */
export async function runStep(
  machine: SandboxHandle,
  command: string,
  signal?: AbortSignal,
) {
  const line = stepCommand();
  await machine.writeFiles([{ path: line.file, content: `${command}\n` }]);
  const result = await machine.runCommand({
    cmd: line.cmd,
    args: line.args,
    timeoutMs: (COMPUTER_COMMAND_SECONDS + 15) * 1000,
    signal,
  });
  return {
    exitCode: result.exitCode,
    output:
      `${result.stdout}${result.stderr ? `\n${result.stderr}` : ""}`.trim(),
    durationMs: result.durationMs,
  };
}

export type ComputerRun = {
  steps: ComputerStep[];
  /** Why the computer could not be used, when it could not. */
  error: string | null;
  /** Stops the machine (files kept); call after the answer is sent. */
  release: () => Promise<void>;
};

/**
 * Plan, run, look at the output, plan again, up to COMPUTER_MAX_STEPS. The
 * machine is only started once the planner asks for a first command.
 */
export async function runComputer(input: {
  driver: SandboxDriver;
  workspaceId: string;
  botId: string;
  plan: ComputerPlanner;
  onStep?: (step: ComputerStep) => void;
  onOpen?: () => void;
  signal?: AbortSignal;
  /** Where the bot's working folder is kept between uses. */
  files?: ComputerFiles;
}): Promise<ComputerRun> {
  const steps: ComputerStep[] = [];
  let machine: SandboxHandle | null = null;
  const release = async () => {
    if (!machine) return;
    if (input.files) await saveFolder(machine, input.files).catch(() => false);
    await machine.stop().catch(() => undefined);
  };
  const deadline = Date.now() + COMPUTER_BUDGET_MS;
  if (!input.driver.availability().configured)
    return { steps, error: "not_configured", release };
  try {
    while (steps.length < COMPUTER_MAX_STEPS && Date.now() < deadline) {
      if (input.signal?.aborted) break;
      const next = await input.plan(steps);
      if (!next) break;
      if (!machine) {
        input.onOpen?.();
        machine = await openComputer(
          input.driver,
          computerName(input.workspaceId, input.botId),
          input.signal,
          input.files,
        );
      }
      const ran = await runStep(machine, next.command, input.signal);
      const step: ComputerStep = { ...next, ...ran };
      steps.push(step);
      input.onStep?.(step);
    }
    return { steps, error: null, release };
  } catch (error) {
    if (input.signal?.aborted) return { steps, error: "cancelled", release };
    // The cause for the operator (credentials removed); a code for callers.
    console.error(
      "bot.computer failed",
      JSON.stringify(sandboxErrorSummary(error)),
    );
    return { steps, error: "computer_failed", release };
  }
}

/**
 * Delete bots' machines with their files and snapshots, when the bots or
 * the account go. Best effort and after the response: a machine that
 * cannot be reached now is gone within a week anyway (snapshot expiry).
 */
export async function deleteComputers(
  driver: SandboxDriver,
  workspaceId: string,
  botIds: string[],
) {
  if (!driver.availability().configured || !driver.reattach) return;
  for (const botId of botIds) {
    const machine = await driver
      .reattach(computerName(workspaceId, botId))
      .catch(() => null);
    await machine?.destroy?.().catch(() => undefined);
  }
}
