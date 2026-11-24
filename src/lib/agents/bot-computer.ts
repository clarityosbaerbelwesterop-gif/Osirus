import "server-only";
import type { ProductIdentity } from "../auth/bootstrap";
import type { GatewayModel } from "../gateway/models";
import { completeGateway } from "../gateway/stream";
import { estimateTokens, recordGatewayCall } from "../gateway/usage";
import type { SandboxDriver, SandboxHandle } from "../sandbox/driver";
import { sandboxErrorSummary } from "../sandbox/error-summary";
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
const PLAN_MODELS = 2;

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
    for (const model of input.models.slice(0, PLAN_MODELS)) {
      if (input.signal?.aborted) return null;
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
        logPlan(
          model.ref,
          "error",
          (error as { code?: unknown } | null)?.code ?? "provider_error",
        );
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

/** The bot's machine, resumed with its files, or created on first use. */
export async function openComputer(
  driver: SandboxDriver,
  name: string,
  signal?: AbortSignal,
): Promise<SandboxHandle> {
  const existing = driver.reattach
    ? await driver.reattach(name).catch(() => null)
    : null;
  if (existing) return existing;
  const machine = {
    timeoutMs: MACHINE_TIMEOUT_MS,
    allowedDomains: COMPUTER_ALLOWED_DOMAINS,
    signal,
  };
  try {
    return await driver.create({ ...machine, name, persistent: true });
  } catch (error) {
    // The plan's snapshot storage is full (402): the bot still gets a
    // computer for this answer, its files are just not kept this time.
    if (!storageFull(error)) throw error;
    console.warn("bot.computer without files: snapshot storage full");
    return driver.create(machine);
  }
}

/** Vercel's answer when the plan's sandbox or snapshot quota is used up. */
export function storageFull(error: unknown) {
  const status = (error as { response?: { status?: unknown } } | null)?.response
    ?.status;
  return (
    status === 402 ||
    (error instanceof Error &&
      /payment_required|Snapshots Storage/i.test(error.message))
  );
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
}): Promise<ComputerRun> {
  const steps: ComputerStep[] = [];
  let machine: SandboxHandle | null = null;
  const release = async () => {
    await machine?.stop().catch(() => undefined);
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
