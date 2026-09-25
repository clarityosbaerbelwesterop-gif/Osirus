// What software self-improvement may change (M45).
//
// Self-improvement may modify the agent. It may not remove the constraints
// that make self-improvement trustworthy. The trust root below is refused
// outright; a proposal whose target lies there is recorded for the operator
// and never opened by the pipeline. Everything else must also sit on the
// allowlist, stay small, leave tests and the evaluation alone, and pass the
// static rules on every added line. The pipeline never merges: a verified
// patch becomes a draft pull request on an rsi/* branch, and a human decides.

export const RSI_BRANCH_PREFIX = "rsi/";
export const RSI_LABEL = "software-rsi";

/** The immutable trust root: never changed by the pipeline. */
export const TRUST_ROOT: Array<{ area: string; pattern: RegExp }> = [
  { area: "authentication", pattern: /^src\/lib\/auth\// },
  { area: "authentication", pattern: /^src\/app\/api\/auth\// },
  { area: "authentication", pattern: /^src\/(middleware|proxy)\.ts$/ },
  { area: "tenancy and access", pattern: /^src\/lib\/security\// },
  { area: "tenancy and access", pattern: /^src\/lib\/entitlements\// },
  { area: "tenancy and access", pattern: /^src\/lib\/policy\// },
  { area: "row-level security", pattern: /^db\// },
  { area: "row-level security", pattern: /^src\/lib\/db\// },
  { area: "row-level security", pattern: /\/(repository|db-store|store)\.ts$/ },
  { area: "secrets", pattern: /^src\/lib\/env\.ts$/ },
  { area: "secrets", pattern: /^scripts\// },
  { area: "secrets", pattern: /(^|\/)\.env/ },
  { area: "evaluation integrity", pattern: /^src\/lib\/verification\// },
  { area: "evaluation integrity", pattern: /^src\/lib\/intelligence\// },
  { area: "evaluation integrity", pattern: /^src\/lib\/agent\/pulse\// },
  { area: "evaluation integrity", pattern: /^src\/lib\/arena\// },
  { area: "evaluation integrity", pattern: /^tests\// },
  { area: "evaluation integrity", pattern: /^evals\// },
  { area: "promotion rules", pattern: /^src\/lib\/strategy\// },
  { area: "rollback and audit log", pattern: /^src\/lib\/telemetry\// },
  {
    area: "budget enforcement",
    pattern:
      /^src\/lib\/runtime\/(budget|settlement|worker|dispatch|executor)\.ts$/,
  },
  // The loop's step and call bounds are budgets; tool permissions and
  // approval gates live in the toolbox and the arm base.
  { area: "budget enforcement", pattern: /^src\/lib\/agent\/loop\.ts$/ },
  { area: "tool permissions", pattern: /^src\/lib\/agent\/toolbox\.ts$/ },
  { area: "approval gates", pattern: /^src\/lib\/arms\/base\.ts$/ },
  { area: "sandbox boundary", pattern: /^src\/lib\/sandbox\// },
  { area: "sandbox boundary", pattern: /^src\/lib\/tools\/registry\.ts$/ },
  {
    area: "sandbox boundary",
    pattern: /^src\/lib\/coding\/(workspace|delivery)\.ts$/,
  },
  { area: "platform", pattern: /^\.github\// },
  { area: "platform", pattern: /^src\/app\/api\// },
  {
    area: "platform",
    pattern:
      /^(package(-lock)?\.json|next\.config\.\w+|vercel\.json|tsconfig\.json)$/,
  },
];

/** Where an agent-behaviour patch may land. */
export const ALLOWLIST: RegExp[] = [
  /^src\/lib\/agent\/[\w-]+\.ts$/,
  /^src\/lib\/arms\/[\w-]+\.ts$/,
  /^src\/lib\/research\/(citations|authority|evidence-ledger|pipeline)\.ts$/,
  /^src\/lib\/runtime\/router-v2\.ts$/,
  /^src\/lib\/context\/[\w-]+\.ts$/,
  /^src\/lib\/memory\/(temporal|planes|compiler-v2|causal)\.ts$/,
  /^src\/lib\/compute\/(engine|tools)\.ts$/,
];

export const LIMITS = { files: 3, changedLines: 160 };

/** Added lines must not reach for these. */
const FORBIDDEN_ADDITIONS: Array<{ rule: string; pattern: RegExp }> = [
  { rule: "no dynamic code", pattern: /\beval\s*\(|\bnew\s+Function\s*\(/ },
  {
    rule: "no process spawning",
    pattern: /child_process|\bexecSync\b|\bspawn\s*\(/,
  },
  {
    rule: "no environment or secrets",
    pattern: /process\.env|API_KEY|SECRET|TOKEN/,
  },
  {
    rule: "no new network access",
    pattern: /\bfetch\s*\(|https?:\/\/(?!example\.)/,
  },
  {
    rule: "no filesystem writes",
    pattern: /\bwriteFile|\bunlink|\brmSync|\bappendFile/,
  },
  {
    rule: "no SQL",
    pattern: /\b(select|insert|update|delete)\b[^\n]{0,40}\b(from|into|set)\b/i,
  },
  {
    rule: "no new imports of platform modules",
    pattern:
      /from\s+["'](node:)?(fs|net|http|https|child_process|worker_threads)["']/,
  },
  {
    rule: "no suppressed checks",
    pattern: /@ts-(ignore|nocheck|expect-error)|eslint-disable/,
  },
];

export type PatchFile = {
  path: string;
  /** Lines the patch adds (without the leading "+"). */
  added: string[];
  removed: number;
};

export type PolicyVerdict = {
  allowed: boolean;
  trustRoot: string[];
  violations: string[];
};

export function trustRootArea(path: string) {
  return TRUST_ROOT.find((entry) => entry.pattern.test(path))?.area ?? null;
}

export function onAllowlist(path: string) {
  return (
    trustRootArea(path) === null &&
    ALLOWLIST.some((pattern) => pattern.test(path))
  );
}

/** Judge a patch before anything runs it. */
export function checkPatch(files: PatchFile[]): PolicyVerdict {
  const violations: string[] = [];
  const trustRoot: string[] = [];
  if (!files.length) violations.push("empty patch");
  if (files.length > LIMITS.files)
    violations.push(`${files.length} files (limit ${LIMITS.files})`);
  const lines = files.reduce(
    (sum, file) => sum + file.added.length + file.removed,
    0,
  );
  if (lines > LIMITS.changedLines)
    violations.push(`${lines} changed lines (limit ${LIMITS.changedLines})`);
  for (const file of files) {
    if (file.path.includes("..") || file.path.startsWith("/"))
      violations.push(`${file.path}: path escapes the repository`);
    const area = trustRootArea(file.path);
    if (area) {
      trustRoot.push(`${file.path} (${area})`);
      continue;
    }
    if (!onAllowlist(file.path))
      violations.push(`${file.path}: not on the allowlist`);
    for (const line of file.added)
      for (const rule of FORBIDDEN_ADDITIONS)
        if (rule.pattern.test(line))
          violations.push(
            `${file.path}: ${rule.rule} ("${line.trim().slice(0, 60)}")`,
          );
  }
  return {
    allowed: violations.length === 0 && trustRoot.length === 0,
    trustRoot,
    violations,
  };
}

/** Parse a unified diff into the files it touches. */
export function parseUnifiedDiff(diff: string): PatchFile[] {
  const files: PatchFile[] = [];
  let current: PatchFile | null = null;
  for (const line of diff.split("\n")) {
    const header = /^\+\+\+ b\/(.+)$/.exec(line);
    if (header) {
      current = { path: header[1]!, added: [], removed: 0 };
      files.push(current);
      continue;
    }
    if (!current || line.startsWith("+++") || line.startsWith("---")) continue;
    if (line.startsWith("+")) current.added.push(line.slice(1));
    else if (line.startsWith("-")) current.removed += 1;
  }
  return files;
}

export function validBranch(name: string) {
  return (
    name.startsWith(RSI_BRANCH_PREFIX) &&
    /^rsi\/[a-z0-9][a-z0-9._-]{2,60}$/.test(name)
  );
}
