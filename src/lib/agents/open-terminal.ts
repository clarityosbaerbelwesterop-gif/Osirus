import "server-only";
import { randomBytes } from "node:crypto";
import type { SandboxHandle } from "../sandbox/driver";

// Open Terminal (open-webui/open-terminal, MIT) on every bot's cloud
// computer: files, shell, package managers and running processes behind one
// API, the way Open WebUI gives its agents a computer. It listens on the
// machine's loopback only; Osirus reaches it from inside the machine, so no
// port is ever public. Its bearer key is random per machine and lives in the
// machine's own files.

export const OPEN_TERMINAL_VERSION = "0.17.22";
export const OPEN_TERMINAL_PORT = 8765;
const KEY_FILE = ".osirus/open-terminal.key";
const REQUEST_FILE = ".osirus/open-terminal.request.json";
const LOG_FILE = ".osirus/open-terminal.log";
const PID_FILE = ".osirus/open-terminal.pid";
const READY_TRIES = 40;

export type TerminalRequest = {
  method: "GET" | "POST" | "DELETE";
  path: string;
  query?: Record<string, string | number | undefined>;
  body?: unknown;
};

/** The request path with its query, from validated parts only. */
export function terminalPath(request: TerminalRequest) {
  if (!/^\/[a-z0-9/_{}-]*$/i.test(request.path))
    throw new Error("open_terminal_bad_path");
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(request.query ?? {}))
    if (value !== undefined) query.set(key, String(value));
  const text = query.toString();
  return `${request.path}${text ? `?${text}` : ""}`;
}

/**
 * The shell line that calls the local API. The key is read from the file
 * on the machine, the body from a file: neither is part of the line.
 */
export function terminalCurl(request: TerminalRequest) {
  const url = `http://127.0.0.1:${OPEN_TERMINAL_PORT}${terminalPath(request)}`;
  return [
    'curl -sS --max-time 330 -w "\\n%{http_code}"',
    `-X ${request.method}`,
    `-H "Authorization: Bearer $(cat ${KEY_FILE})"`,
    request.body === undefined
      ? ""
      : `-H "content-type: application/json" --data-binary @${REQUEST_FILE}`,
    `'${url}'`,
  ]
    .filter(Boolean)
    .join(" ");
}

/** curl's output: the body, then the status on the last line. */
export function parseTerminalResponse(stdout: string) {
  const cut = stdout.lastIndexOf("\n");
  const status = Number(stdout.slice(cut + 1).trim());
  const text = cut < 0 ? "" : stdout.slice(0, cut);
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    // plain text (a file's contents)
  }
  return { status: Number.isFinite(status) ? status : 0, body };
}

/** Starts the server in the background; the key comes from the file. */
export function startLine() {
  return [
    "mkdir -p work .osirus",
    `echo $$ > ${PID_FILE}`,
    `OPEN_TERMINAL_API_KEY="$(cat ${KEY_FILE})" exec ${VENV}/bin/python -m open_terminal run --isolated --host 127.0.0.1 --port ${OPEN_TERMINAL_PORT} --cwd work > ${LOG_FILE} 2>&1`,
  ].join(" && ");
}

const READY_LINE = `curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $(cat ${KEY_FILE} 2>/dev/null)" http://127.0.0.1:${OPEN_TERMINAL_PORT}/execute`;

// Its own virtual environment in the machine's files (kept by the snapshot):
// the system Python's packages stay untouched and none are "managed".
const VENV = ".osirus/open-terminal-venv";
const INSTALL_LINE = `test -x ${VENV}/bin/python && ${VENV}/bin/python -c "import open_terminal" 2>/dev/null || { python3 -m venv ${VENV} && ${VENV}/bin/python -m pip install --quiet --disable-pip-version-check "open-terminal==${OPEN_TERMINAL_VERSION}"; }`;

async function shell(
  machine: SandboxHandle,
  line: string,
  timeoutMs: number,
  signal?: AbortSignal,
) {
  return machine.runCommand({
    cmd: "bash",
    args: ["-c", line],
    timeoutMs,
    signal,
  });
}

/**
 * Open Terminal running on the bot's machine: installed on first use (the
 * install stays in the machine's files), started after every resume.
 */
export async function ensureOpenTerminal(
  machine: SandboxHandle,
  signal?: AbortSignal,
) {
  if (!(await machine.readFile(KEY_FILE))) {
    await machine.writeFiles([
      { path: KEY_FILE, content: randomBytes(24).toString("hex") },
    ]);
    await shell(machine, `chmod 600 ${KEY_FILE}`, 10_000, signal);
  }
  const probe = await shell(machine, READY_LINE, 15_000, signal);
  if (probe.stdout.trim() === "200") return;
  const installed = await shell(machine, INSTALL_LINE, 180_000, signal);
  if (installed.exitCode !== 0) throw new Error("open_terminal_install_failed");
  if (!machine.startBackground) throw new Error("open_terminal_no_background");
  await machine.startBackground({ cmd: "bash", args: ["-c", startLine()] });
  for (let attempt = 0; attempt < READY_TRIES; attempt += 1) {
    const ready = await shell(
      machine,
      `sleep 0.5; ${READY_LINE}`,
      15_000,
      signal,
    );
    if (ready.stdout.trim() === "200") return;
  }
  throw new Error("open_terminal_not_ready");
}

/** One call to the machine's Open Terminal API. */
export async function callOpenTerminal(
  machine: SandboxHandle,
  request: TerminalRequest,
  signal?: AbortSignal,
) {
  if (request.body !== undefined)
    await machine.writeFiles([
      { path: REQUEST_FILE, content: JSON.stringify(request.body) },
    ]);
  const result = await shell(machine, terminalCurl(request), 340_000, signal);
  return parseTerminalResponse(result.stdout);
}
