import ts from "typescript";
import { z } from "zod";

// The pure parts of the software-RSI pipeline (M45): find the code under
// test, ask for a bounded replacement, splice it in, and judge the result.
// The orchestration (processes, git, the pull request) lives in the Actions
// runner; everything a decision rests on is here and tested.

/**
 * The environment for every command that runs patched, model-written code:
 * no model keys, no GitHub or Vercel token, no OIDC request token, no runner
 * token. Whatever the patch does, it has nothing to use.
 */
const CREDENTIAL =
  /TOKEN|SECRET|PASSWORD|CREDENTIAL|_KEY$|_KEY_|^KEY|UNOROUTER|^GH_|ACTIONS_ID_TOKEN|ACTIONS_RUNTIME|ACTIONS_CACHE_URL|ACTIONS_RESULTS_URL|VERCEL/i;

export function credentialFreeEnv(
  extra: Record<string, string> = {},
  source: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const env = {} as NodeJS.ProcessEnv;
  for (const [key, value] of Object.entries(source))
    if (value !== undefined && !CREDENTIAL.test(key)) env[key] = value;
  return { ...env, ...extra };
}

export type SymbolSpan = { start: number; end: number; text: string };

/** The source range of a function, a class method (Class.method) or a const. */
export function findSymbol(source: string, symbol: string): SymbolSpan | null {
  const file = ts.createSourceFile(
    "x.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
  );
  const [owner, member] = symbol.includes(".")
    ? (symbol.split(".") as [string, string])
    : [null, symbol];
  let found: ts.Node | null = null;
  const visit = (node: ts.Node) => {
    if (found) return;
    if (!owner) {
      if (ts.isFunctionDeclaration(node) && node.name?.text === member)
        found = node;
      else if (
        ts.isVariableStatement(node) &&
        node.declarationList.declarations.some(
          (declaration) =>
            ts.isIdentifier(declaration.name) &&
            declaration.name.text === member,
        )
      )
        found = node;
    } else if (ts.isClassDeclaration(node) && node.name?.text === owner) {
      for (const element of node.members)
        if (
          ts.isMethodDeclaration(element) &&
          element.name.getText(file) === member
        )
          found = element;
    }
    if (!found) ts.forEachChild(node, visit);
  };
  visit(file);
  if (!found) return null;
  const node = found as ts.Node;
  const start = node.getStart(file, false);
  const end = node.getEnd();
  return { start, end, text: source.slice(start, end) };
}

export function spliceSymbol(
  source: string,
  span: SymbolSpan,
  replacement: string,
) {
  return `${source.slice(0, span.start)}${replacement.trim()}${source.slice(span.end)}`;
}

/** Whether a TypeScript text parses without syntax errors. */
export function parses(source: string) {
  const file = ts.createSourceFile(
    "x.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
  );
  return (
    (file as unknown as { parseDiagnostics?: unknown[] }).parseDiagnostics
      ?.length === 0
  );
}

export const patchProposalSchema = z.object({
  rationale: z.string().min(10).max(2_000),
  replacement: z.string().min(10).max(20_000),
});
export type PatchProposal = z.infer<typeof patchProposalSchema>;

export type MeasuredRow = {
  arena: string;
  level: number;
  seed: string;
  held: number;
  failed: number;
  invalid: number;
  instances: number;
  failures: Array<{ detail: string; text: string }>;
};

export function tally(
  rows: MeasuredRow[],
  filter?: (row: MeasuredRow) => boolean,
) {
  const chosen = filter ? rows.filter(filter) : rows;
  return {
    held: chosen.reduce((sum, row) => sum + row.held, 0),
    instances: chosen.reduce((sum, row) => sum + row.instances, 0),
  };
}

/** (arena, level) cells whose held count fell from baseline to patched. */
export function regressions(baseline: MeasuredRow[], patched: MeasuredRow[]) {
  const key = (row: MeasuredRow) => `${row.arena}:L${row.level}:${row.seed}`;
  const before = new Map(baseline.map((row) => [key(row), row]));
  const out: string[] = [];
  for (const row of patched) {
    const prior = before.get(key(row));
    if (prior && row.held < prior.held)
      out.push(`${row.arena} L${row.level} (${prior.held}→${row.held})`);
    if (row.invalid > (prior?.invalid ?? 0))
      out.push(`${row.arena} L${row.level} invalid instances`);
  }
  return [...new Set(out)];
}

export type Judgement = {
  improved: boolean;
  reasons: string[];
};

/**
 * A patch is an improvement only if every existing test passes, it holds
 * strictly more unseen (holdout-seed) instances of the target arena than the
 * code it replaces, and no other arena or level got worse.
 */
export function judgePatch(input: {
  testsPassed: boolean;
  typecheckPassed: boolean;
  lintPassed: boolean;
  baseline: { held: number; instances: number };
  patched: { held: number; instances: number };
  regressions: string[];
}): Judgement {
  const reasons: string[] = [];
  if (!input.typecheckPassed) reasons.push("typecheck failed");
  if (!input.lintPassed) reasons.push("lint failed");
  if (!input.testsPassed) reasons.push("the existing test suite failed");
  if (input.patched.held <= input.baseline.held)
    reasons.push(
      `unseen instances held ${input.patched.held}/${input.patched.instances}, not more than ${input.baseline.held}/${input.baseline.instances}`,
    );
  if (input.regressions.length)
    reasons.push(`regressions: ${input.regressions.join(", ")}`);
  return { improved: reasons.length === 0, reasons };
}

/**
 * Why a proposal request produced no proposal. A malformed answer is the
 * model's: the next attempt may do better. Anything else (a rate limit, no
 * credit, a timeout, an outage) is the provider's: it says nothing about the
 * code, and asking again only spends more of a scarce free quota.
 */
export function proposalFailure(error: unknown): {
  infrastructure: boolean;
  reason: string;
} {
  const code =
    error instanceof Error && "code" in error
      ? String((error as { code: unknown }).code)
      : null;
  const message =
    error instanceof Error ? error.message.slice(0, 200) : "error";
  if (code === null || code === "invalid_json")
    return { infrastructure: false, reason: `no valid proposal: ${message}` };
  return {
    infrastructure: true,
    reason: `provider ${code}: ${message}`,
  };
}

/** The prompt for one attempt. Dev failures only: holdout seeds stay unseen. */
export function patchPrompt(input: {
  file: string;
  symbol: string;
  statement: string;
  expected: string;
  verifier: string;
  code: string;
  context: string;
  failures: Array<{ detail: string; text: string }>;
  previous?: { reasons: string[]; replacement: string } | null;
}) {
  return [
    `You are improving one function of Osirus, a TypeScript agent platform.`,
    `File: ${input.file}`,
    `Symbol: ${input.symbol}`,
    ``,
    `Problem, found by an automated adversarial generator:`,
    input.statement,
    `Expected after the fix: ${input.expected}`,
    `Independent oracle: ${input.verifier}`,
    ``,
    `Failing examples (generated; the fix must generalise, not special-case them):`,
    ...input.failures
      .slice(0, 6)
      .map((failure) => `- ${failure.text} → ${failure.detail}`),
    ``,
    `Current code of ${input.symbol}:`,
    "```ts",
    input.code,
    "```",
    ``,
    `Surrounding file (read-only context):`,
    "```ts",
    input.context,
    "```",
    ...(input.previous
      ? [
          ``,
          `Your previous attempt was rejected: ${input.previous.reasons.join("; ")}.`,
        ]
      : []),
    ``,
    `Rules:`,
    `- Return the complete new source of ${input.symbol} only (you may put small helper functions directly above it in the same text).`,
    `- Keep the exported name and signature. Keep existing behaviour for inputs that already work.`,
    `- No new imports, no environment access, no network, no filesystem, no eval, no comments that disable checks.`,
    `- Plain TypeScript that compiles under strict mode.`,
    `Answer as JSON: {"rationale": "...", "replacement": "..."}`,
  ].join("\n");
}

/** The evidence table the draft pull request carries. */
export function evidenceTable(input: {
  arena: string;
  levels: number[];
  baseline: { held: number; instances: number };
  patched: { held: number; instances: number };
  dev: { held: number; instances: number };
  regressionCells: number;
  regressions: string[];
  checks: Record<string, boolean>;
  modelCalls: number;
  model: string;
}) {
  const pct = (entry: { held: number; instances: number }) =>
    entry.instances
      ? `${((entry.held / entry.instances) * 100).toFixed(0)}%`
      : "–";
  return [
    `| Measure | Before | After |`,
    `|---|---|---|`,
    `| ${input.arena} L${input.levels.join(",")} — unseen seeds | ${input.baseline.held}/${input.baseline.instances} (${pct(input.baseline)}) | ${input.patched.held}/${input.patched.instances} (${pct(input.patched)}) |`,
    `| Dev seeds shown to the model | – | ${input.dev.held}/${input.dev.instances} |`,
    `| Other arena cells checked for regressions | ${input.regressionCells} | ${input.regressions.length ? input.regressions.join("; ") : "none worse"} |`,
    ...Object.entries(input.checks).map(
      ([name, ok]) => `| ${name} | – | ${ok ? "pass" : "FAIL"} |`,
    ),
    `| Model calls (${input.model}) | – | ${input.modelCalls} |`,
  ].join("\n");
}
