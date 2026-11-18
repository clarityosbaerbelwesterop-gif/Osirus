import { createHash } from "node:crypto";

// Pure parts of the bots' cloud computer (no server-only imports, unit
// tested). Every bot has its own Linux machine, like Grok's code runner or
// Open Terminal: files, shell, package managers and processes. Files in
// ~/work stay between conversations. The machine is a Vercel Sandbox with
// outbound network limited to package registries, so nothing it does acts
// on the outside world; it runs without an approval step.

export type ComputerStep = {
  command: string;
  reason: string;
  exitCode: number | null;
  output: string;
  durationMs: number;
};

export const COMPUTER_MAX_STEPS = 4;
/** Each command's own limit inside the machine. */
export const COMPUTER_COMMAND_SECONDS = 60;
/** Whole computer phase of one answer, planning included. */
export const COMPUTER_BUDGET_MS = 150_000;
/** Output shown to the model per step (the end matters most). */
export const COMPUTER_OUTPUT_CHARS = 4_000;
/** Bytes read back from the machine per step. */
const STREAM_BYTES = 64 * 1024;

/** Hosts the machine may reach: package registries, nothing else. */
export const COMPUTER_ALLOWED_DOMAINS = [
  "pypi.org",
  "files.pythonhosted.org",
  "registry.npmjs.org",
];

const WANTS_COMPUTER =
  /\b(rechne\w*|berechne\w*|ausrechnen|ausführ\w*|führ\w*\s.{0,40}\saus|run|execute|compute|calculate|python|node(js)?|javascript|typescript|skript|script|bash|shell|terminal|konsole|computer|rechner|install\w*|pip|npm|paket\w*|package\w*|datei\w*|files?|ordner|verzeichnis\w*|directory|csv|json|xml|yaml|zip|konvertier\w*|convert|umwandeln|primzahl\w*|prime|fibonacci|sortier\w*|regex|hash|sha\d*|md5|base64|uuid|zufallszahl\w*|random|simulier\w*|simulate|statistik\w*|statistics|mittelwert|median|diagramm|plot|programmier\w*|code)\b/i;

/**
 * Whether a message plausibly needs the computer. False skips the planning
 * call entirely; true costs one planning call, which may still decline.
 */
export function computerWorthwhile(message: string) {
  return WANTS_COMPUTER.test(message);
}

/**
 * The machine's name: one per bot and workspace, stable across requests so
 * the same files come back, and free of anything personal.
 */
export function computerName(workspaceId: string, botId: string) {
  const digest = createHash("sha256")
    .update(`osirus-bot-computer:${workspaceId}:${botId}`)
    .digest("hex")
    .slice(0, 24);
  return `osirus-pc-${digest}`;
}

/**
 * The shell line that runs one step. The model's script is a file, never
 * part of this line; `timeout` ends runaway commands (exit 124) and
 * `head -c` bounds what is read back.
 */
export function stepCommand() {
  return {
    file: ".osirus/step.sh",
    cmd: "bash",
    args: [
      "-c",
      `mkdir -p work && cd work && set -o pipefail; timeout -k 2 ${COMPUTER_COMMAND_SECONDS} bash ../.osirus/step.sh 2>&1 | head -c ${STREAM_BYTES}`,
    ],
  };
}

/** The end of long output matters most (the error, the result): keep it. */
export function capStepOutput(text: string, max = COMPUTER_OUTPUT_CHARS) {
  if (text.length <= max) return text;
  return `… (${text.length - max} Zeichen gekürzt)\n${text.slice(-max)}`;
}

function transcript(
  steps: ComputerStep[],
  outputChars = COMPUTER_OUTPUT_CHARS,
) {
  return steps
    .map(
      (step, index) =>
        `Step ${index + 1}: $ ${step.command}\n[exit ${step.exitCode ?? "timeout"}]\n${capStepOutput(step.output, outputChars) || "(no output)"}`,
    )
    .join("\n\n");
}

/** The planner prompt: one next command as JSON, or null when done. */
export function computerPlanMessages(input: {
  botName: string;
  message: string;
  steps: ComputerStep[];
}) {
  return [
    {
      role: "system" as const,
      content: [
        `You operate the personal Linux cloud computer of the bot "${input.botName}".`,
        "It has bash, python3, node and npm, pip, the usual Unix tools and a working directory (~/work) whose files stay between conversations.",
        "Outbound network: only the package registries (pip, npm). No other websites.",
        "Decide the single next shell command (a short bash script is fine) that brings the person's request closer to a correct answer, or null when the steps so far are enough or the request needs no computer at all (small talk, opinions, plain knowledge, writing).",
        "Prefer one command that does the whole job; print the result. Never print secrets, never loop forever, keep output short.",
        'Reply with one JSON object and nothing else: {"command": "<bash>" | null, "reason": "<one short German sentence: what it does>"}',
      ].join("\n"),
    },
    {
      role: "user" as const,
      content:
        `Request:\n${input.message.slice(0, 4_000)}` +
        (input.steps.length
          ? `\n\nSteps so far on the computer:\n${transcript(input.steps, 2_500)}`
          : ""),
    },
  ];
}

/** The planner's reply, or null when it is unusable or declines. */
export function parseComputerStep(
  text: string,
): { command: string; reason: string } | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let value: unknown;
  try {
    value = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!value || typeof value !== "object") return null;
  const command = (value as { command?: unknown }).command;
  const reason = (value as { reason?: unknown }).reason;
  if (typeof command !== "string") return null;
  const trimmed = command.trim();
  if (!trimmed || trimmed.length > 8_000) return null;
  return {
    command: trimmed,
    reason: typeof reason === "string" ? reason.trim().slice(0, 200) : "",
  };
}

/** What the answering model is told about the computer's real results. */
export function computerMaterial(steps: ComputerStep[]) {
  if (!steps.length) return "";
  return [
    "",
    "You used your own cloud computer for this answer. These commands really ran, with this output:",
    "```",
    transcript(steps),
    "```",
    "Base the answer on this real output and never invent results it does not show. Say briefly what you ran when it helps; if a step failed, say so.",
  ].join("\n");
}

/** A step as the browser and the stored thread see it. */
export function publicStep(step: ComputerStep) {
  return {
    command: step.command.slice(0, 2_000),
    reason: step.reason,
    exitCode: step.exitCode,
    output: capStepOutput(step.output, 2_000),
    durationMs: step.durationMs,
  };
}
