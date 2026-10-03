/**
 * A coding action leaves the task when it would work a different repository
 * or a different branch than the one this run was started on. Stopping is
 * honest: the run does not finish the task. This is not a scan or an attack.
 */

export class CodingTaskLeft extends Error {
  constructor(reason: string) {
    super(`task_left:${reason}`);
    this.name = "CodingTaskLeft";
  }
}

function githubRepo(value: string) {
  const match = value
    .trim()
    .match(/^https:\/\/github\.com\/([^/\s]+)\/([^/\s]+?)(?:\.git)?$/i);
  if (!match) return null;
  return `${match[1]}/${match[2]}`.toLowerCase();
}

function collectStrings(value: unknown, into: string[]) {
  if (typeof value === "string") into.push(value);
  else if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, into);
  } else if (value && typeof value === "object") {
    for (const item of Object.values(value)) collectStrings(item, into);
  }
}

/**
 * Branch a git checkout/switch would move to, or null when the command stays
 * on the current branch (status, file paths, or no branch target).
 */
export function gitBranchTarget(args: string[]): string | null {
  const sub = args.find((arg) => !arg.startsWith("-"));
  if (sub !== "checkout" && sub !== "switch") return null;
  const dash = args.indexOf("--");
  const before = dash === -1 ? args : args.slice(0, dash);
  const positional = before.filter(
    (arg) => arg !== sub && !arg.startsWith("-"),
  );
  if (positional.length === 0) return null;
  const target = positional[0] ?? "";
  if (!target || target.includes("/") || target.startsWith(".")) return null;
  return target;
}

export function actionLeavesCodingTask(input: {
  repository: string;
  branch: string;
  toolId: string;
  toolInput: unknown;
}): string | null {
  const granted = githubRepo(input.repository);
  const strings: string[] = [];
  collectStrings(input.toolInput, strings);
  if (granted) {
    for (const value of strings) {
      const named = githubRepo(value);
      if (named && named !== granted) return "other_repository";
    }
  }
  if (input.toolId !== "workspace.run") return null;
  const row =
    input.toolInput && typeof input.toolInput === "object"
      ? (input.toolInput as { cmd?: unknown; args?: unknown })
      : {};
  if (row.cmd !== "git" || !Array.isArray(row.args)) return null;
  const args = row.args.filter((arg): arg is string => typeof arg === "string");
  const target = gitBranchTarget(args);
  if (!target) return null;
  if (target !== input.branch) return "other_branch";
  return null;
}

/** True when a click would leave the coding task that is in progress. */
export function navigationLeavesCodingTask(target: URL, current: URL) {
  if (target.origin !== current.origin) return true;
  const coding =
    target.pathname === "/app/coding" ||
    target.pathname.startsWith("/app/coding/");
  if (!coding) return true;
  if (target.searchParams.get("new") === "1") return true;
  const nextSession = target.searchParams.get("session");
  const currentSession = current.searchParams.get("session");
  return Boolean(
    nextSession && currentSession && nextSession !== currentSession,
  );
}
