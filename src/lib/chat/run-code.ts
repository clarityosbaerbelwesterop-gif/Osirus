import type { CommandResult, SandboxDriver } from "@/lib/sandbox/driver";

// Running a code block from a chat answer (Grok review 2026-11-15: "nothing
// runs the code in chat, so a failing test goes unnoticed; the biggest gap
// to Claude Code").
//
// Each run gets a fresh sandbox with no network at all (the driver denies
// every host unless a caller names one), one file, one command, a hard time
// limit and capped output, and the sandbox is stopped afterwards whatever
// happened. Nothing the code does outlives the request.

export type RunLanguage = "python" | "javascript" | "typescript";

const ALIASES: Record<string, RunLanguage> = {
  python: "python",
  python3: "python",
  py: "python",
  javascript: "javascript",
  js: "javascript",
  node: "javascript",
  mjs: "javascript",
  typescript: "typescript",
  ts: "typescript",
};

/** The language a fenced block's tag names, when Osirus can run it. */
export function runnableLanguage(tag: string | null | undefined) {
  return tag ? (ALIASES[tag.trim().toLowerCase()] ?? null) : null;
}

export const MAX_CODE_CHARS = 20_000;
/** The command's own limit, a little above the in-sandbox `timeout`. */
export const RUN_TIMEOUT_MS = 20_000;
const SANDBOX_TIMEOUT_MS = 60_000;
export const MAX_OUTPUT_CHARS = 8_000;

const RUN_SECONDS = 15;
/** Bytes read per stream inside the sandbox; the rest never leaves it. */
const STREAM_BYTES = 64 * 1024;

const PROGRAMS: Record<RunLanguage, { file: string; run: string }> = {
  python: { file: "main.py", run: "python3 -I main.py" },
  javascript: { file: "main.mjs", run: "node main.mjs" },
  typescript: {
    file: "main.ts",
    run: "node --experimental-strip-types --no-warnings main.ts",
  },
};

/**
 * One shell line, built only from constants (the code is a file, never part
 * of the command). `timeout` ends a runaway program inside the sandbox
 * (exit 124), and `head -c` bounds what is read back: a program that keeps
 * printing is cut off by SIGPIPE instead of filling the function's memory.
 */
export function commandFor(language: RunLanguage) {
  const program = PROGRAMS[language];
  return {
    file: program.file,
    cmd: "bash",
    args: [
      "-c",
      `set -o pipefail; timeout -k 2 ${RUN_SECONDS} ${program.run} 2> >(head -c ${STREAM_BYTES} >&2) | head -c ${STREAM_BYTES}`,
    ],
  };
}

/** The end of long output matters most (the error, the summary): keep it. */
export function capOutput(text: string, max = MAX_OUTPUT_CHARS) {
  if (text.length <= max) return text;
  return `… (${text.length - max} Zeichen gekürzt)\n${text.slice(-max)}`;
}

export type RunOutcome = {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
};

export async function runSnippet(input: {
  driver: SandboxDriver;
  language: RunLanguage;
  code: string;
  signal?: AbortSignal;
}): Promise<RunOutcome> {
  const command = commandFor(input.language);
  const sandbox = await input.driver.create({
    timeoutMs: SANDBOX_TIMEOUT_MS,
    signal: input.signal,
  });
  try {
    await sandbox.writeFiles([{ path: command.file, content: input.code }]);
    let result: CommandResult;
    try {
      result = await sandbox.runCommand({
        cmd: command.cmd,
        args: command.args,
        timeoutMs: RUN_TIMEOUT_MS,
        signal: input.signal,
      });
    } catch (error) {
      if (input.signal?.aborted) throw error;
      return {
        exitCode: null,
        stdout: "",
        stderr: "Die Ausführung wurde abgebrochen.",
        durationMs: RUN_TIMEOUT_MS,
        timedOut: true,
      };
    }
    return {
      exitCode: result.exitCode,
      stdout: capOutput(result.stdout),
      stderr: capOutput(result.stderr),
      durationMs: result.durationMs,
      timedOut: result.exitCode === 124 || result.exitCode === 137,
    };
  } finally {
    await sandbox.stop().catch(() => undefined);
  }
}
