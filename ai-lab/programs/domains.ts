import { forwardTokens, initParams, type FixtureArch } from "./architecture";
import { gradeRsiSample } from "./rsi";
import type { ArmGrader, ModelId, ModelProgram } from "./types";

/**
 * Executable domain fixtures for the three model programs.
 * They grade authored inputs. They do not train and they do not score a benchmark.
 */

export const CORE_DOMAINS = [
  "reasoning",
  "thinking",
  "rsi",
  "math",
  "cybersecurity",
  "coding",
  "terminal",
  "long_horizon",
] as const;

export const NEIGHBOR_DOMAINS: Record<ModelId, readonly string[]> = {
  rouge: [
    "science",
    "research",
    "long_context",
    "memory",
    "verification",
    "planning",
  ],
  quasnir: [
    "debugging",
    "repository",
    "code_review",
    "security",
    "vulnerability",
    "devops",
    "database",
    "infrastructure",
    "testing",
    "architecture",
    "logic",
  ],
  darus: [
    "science",
    "research",
    "planning",
    "long_context",
    "memory",
    "tool_reasoning",
    "world_model",
    "multimodal",
    "verification",
    "strategy",
  ],
};

export type DomainGrader = Exclude<
  ArmGrader,
  "exact" | "static-scan" | "patch" | "unit" | "execute" | "regression" | "nll"
>;

export function domainOf(armId: string): string {
  return armId.replace(/^(ROUGE|QUASNIR|DARUS)_/, "").toLowerCase();
}

export function uncoveredDomains(program: ModelProgram): string[] {
  const present = new Set(program.arms.map((arm) => domainOf(arm.id)));
  const needed = [...CORE_DOMAINS, ...NEIGHBOR_DOMAINS[program.id]];
  return needed.filter((domain) => !present.has(domain));
}

export function entailQuery(input: string): "yes" | "no" | "malformed" {
  const factsPart = input.match(/facts:([^;]*)/);
  const rulesPart = input.match(/rules:([^;]*)/);
  const queryPart = input.match(/query:([^;]*)/);
  if (!factsPart || !rulesPart || !queryPart) return "malformed";
  const known = new Set(
    factsPart[1]
      .split(",")
      .map((part) => part.trim())
      .filter((part) => part.length > 0),
  );
  const rules = rulesPart[1]
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((rule) => {
      const splitAt = rule.indexOf(">");
      if (splitAt <= 0) return null;
      const body = rule.slice(0, splitAt);
      const then = rule.slice(splitAt + 1).trim();
      const ifAll = body
        .split("+")
        .map((part) => part.trim())
        .filter((part) => part.length > 0);
      if (!then || ifAll.length === 0) return null;
      return { ifAll, then };
    });
  if (rules.some((rule) => rule === null)) return "malformed";
  let guard = 0;
  let changed = true;
  while (changed && guard < 16) {
    changed = false;
    guard += 1;
    for (const rule of rules) {
      if (!rule) continue;
      if (
        rule.ifAll.every((fact) => known.has(fact)) &&
        !known.has(rule.then)
      ) {
        known.add(rule.then);
        changed = true;
      }
    }
  }
  return known.has(queryPart[1].trim()) ? "yes" : "no";
}

export function evalIntegerExpr(
  source: string,
): { ok: true; value: number } | { ok: false; detail: string } {
  const text = source.replace(/\s+/g, "");
  if (!text) return { ok: false, detail: "empty expression" };
  let index = 0;
  const parseExpr = (): number => {
    let value = parseTerm();
    while (text[index] === "+" || text[index] === "-") {
      const op = text[index];
      index += 1;
      const right = parseTerm();
      value = op === "+" ? value + right : value - right;
    }
    return value;
  };
  const parseTerm = (): number => {
    let value = parseFactor();
    while (text[index] === "*" || text[index] === "/" || text[index] === "%") {
      const op = text[index];
      index += 1;
      const right = parseFactor();
      if ((op === "/" || op === "%") && right === 0) {
        throw new Error("division by zero");
      }
      value =
        op === "*" ? value * right : op === "/" ? value / right : value % right;
      if (!Number.isFinite(value)) throw new Error("non-finite");
    }
    return value;
  };
  const parsePrimary = (): number => {
    if (text[index] === "(") {
      index += 1;
      const value = parseExpr();
      if (text[index] !== ")") throw new Error("missing paren");
      index += 1;
      return value;
    }
    const start = index;
    if (!/\d/.test(text[index] ?? "")) throw new Error("expected number");
    while (/\d/.test(text[index] ?? "")) index += 1;
    return Number(text.slice(start, index));
  };
  const parseFactor = (): number => {
    if (text[index] === "+" || text[index] === "-") {
      const sign = text[index];
      index += 1;
      const value = parseFactor();
      return sign === "-" ? -value : value;
    }
    const base = parsePrimary();
    if (text[index] !== "^") return base;
    index += 1;
    const exp = parseFactor();
    if (!Number.isInteger(exp) || exp < 0 || exp > 8) {
      throw new Error("exponent refused");
    }
    if (base === 0 && exp === 0) throw new Error("zero power refused");
    const value = base ** exp;
    if (!Number.isSafeInteger(value)) throw new Error("exponent refused");
    return value;
  };
  try {
    const value = parseExpr();
    if (index !== text.length) return { ok: false, detail: "trailing input" };
    if (!Number.isInteger(value)) return { ok: false, detail: "non-integer" };
    return { ok: true, value };
  } catch (error) {
    return {
      ok: false,
      detail: error instanceof Error ? error.message : "math failed",
    };
  }
}

export function evalLogic(
  source: string,
): { ok: true; value: boolean } | { ok: false; detail: string } {
  const tokens = source.match(/AND|OR|NOT|true|false|\(|\)/gi);
  if (!tokens) return { ok: false, detail: "no logic expression" };
  const rest = source.replace(/AND|OR|NOT|true|false|\(|\)/gi, "").trim();
  if (rest) return { ok: false, detail: "trailing logic input" };
  let index = 0;
  const current = () => tokens[index];
  const parseOr = (): boolean => {
    let value = parseAnd();
    while (current()?.toUpperCase() === "OR") {
      index += 1;
      const right = parseAnd();
      value = value || right;
    }
    return value;
  };
  const parseAnd = (): boolean => {
    let value = parseNot();
    while (current()?.toUpperCase() === "AND") {
      index += 1;
      const right = parseNot();
      value = value && right;
    }
    return value;
  };
  const parseNot = (): boolean => {
    if (current()?.toUpperCase() === "NOT") {
      index += 1;
      return !parseNot();
    }
    return parsePrimary();
  };
  const parsePrimary = (): boolean => {
    const token = current();
    if (!token) throw new Error("expected term");
    if (token === "(") {
      index += 1;
      const value = parseOr();
      if (current() !== ")") throw new Error("missing paren");
      index += 1;
      return value;
    }
    if (token.toLowerCase() === "true") {
      index += 1;
      return true;
    }
    if (token.toLowerCase() === "false") {
      index += 1;
      return false;
    }
    throw new Error("expected term");
  };
  try {
    const value = parseOr();
    if (index !== tokens.length)
      return { ok: false, detail: "trailing logic input" };
    return { ok: true, value };
  } catch (error) {
    return {
      ok: false,
      detail: error instanceof Error ? error.message : "logic failed",
    };
  }
}

export function logicPhrase(text: string): string | null {
  const found = text.match(
    /\b(?:NOT\s+)?(?:true|false)(?:\s+(?:AND|OR)\s+(?:NOT\s+)?(?:true|false))+\b/i,
  );
  if (!found) return null;
  const result = evalLogic(found[0]);
  if (!result.ok) return `logic: ${result.detail}`;
  return `logic: ${found[0]} = ${result.value}`;
}

export function classifyThinking(text: string): string {
  if (/\bthink(?:ing)?\b/i.test(text)) return "thinking";
  if (/\b(code|function|bug|patch)\b/i.test(text)) return "code";
  if (/\b(security|vuln|scan)\b/i.test(text)) return "security";
  if (
    /\b(math|arithmetic)\b/i.test(text) ||
    /(-?\d+)\s*([+*/-])\s*(-?\d+)/.test(text)
  ) {
    return "math";
  }
  if (/\b(plan|strategy|roadmap)\b/i.test(text)) return "plan";
  if (/\b(research|source|paper|cite)\b/i.test(text)) return "research";
  if (/\b(why|because|entail|reason)\b/i.test(text)) return "reasoning";
  return "other";
}

export function formulaCounts(input: string): string | null {
  if (!/^[A-Z][a-z]?\d*([A-Z][a-z]?\d*)*$/.test(input)) return null;
  const counts = new Map<string, number>();
  for (const match of input.match(/[A-Z][a-z]?\d*/g) ?? []) {
    const symbol = match.match(/^[A-Z][a-z]?/)?.[0];
    const digits = match.slice(symbol?.length ?? 0);
    if (!symbol) return null;
    const amount = digits ? Number(digits) : 1;
    if (!Number.isInteger(amount) || amount <= 0) return null;
    counts.set(symbol, (counts.get(symbol) ?? 0) + amount);
  }
  return [...counts.entries()]
    .map(([symbol, amount]) => `${symbol}:${amount}`)
    .join(",");
}

export function sumList(input: string): number | null {
  const parts = input.split(",").map((part) => part.trim());
  if (parts.length === 0 || parts.some((part) => !/^-?\d+$/.test(part)))
    return null;
  return parts.reduce((total, part) => total + Number(part), 0);
}

export function countRecordedSteps(text: string): {
  count: number;
  executed: 0;
} {
  const parts = text
    .split(/[.\n]/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .slice(0, 5);
  return { count: parts.length, executed: 0 };
}

/**
 * Multi-step horizon record. A later `fail:` step fails the record.
 * Nothing is executed and no score is invented.
 */
export interface HorizonRecord {
  readonly count: number;
  readonly executed: 0;
  readonly scored: false;
  readonly failedAt: number | null;
  readonly malformed: boolean;
}

export function readHorizon(input: string): HorizonRecord {
  const tagged = input
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  const taggedIntent = tagged.some((part) => /^(ok|fail|need):/.test(part));
  if (input.includes(";") && taggedIntent) {
    const structured = tagged.every((part) => /^(ok|fail|need):.+$/.test(part));
    if (!structured) {
      return {
        count: 0,
        executed: 0,
        scored: false,
        failedAt: null,
        malformed: true,
      };
    }
    const held = new Set<string>();
    let failedAt: number | null = null;
    for (let step = 0; step < tagged.length; step += 1) {
      const part = tagged[step] ?? "";
      if (part.startsWith("ok:")) {
        held.add(part.slice(3));
        continue;
      }
      if (part.startsWith("fail:")) {
        failedAt = step + 1;
        break;
      }
      if (!held.has(part.slice(5))) {
        failedAt = step + 1;
        break;
      }
    }
    return {
      count: tagged.length,
      executed: 0,
      scored: false,
      failedAt,
      malformed: false,
    };
  }
  const parts = input
    .split(/[.\n]/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .slice(0, 8);
  return {
    count: parts.length,
    executed: 0,
    scored: false,
    failedAt: null,
    malformed: false,
  };
}

/**
 * Small authored word problems. The value is recorded only after the fields parse.
 * This is not a benchmark score.
 */
export function evalWordProblem(
  source: string,
): { ok: true; value: number } | { ok: false; detail: string } {
  const refused = (detail: string) => ({ ok: false as const, detail });
  const parts = source
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  if (parts.length === 0) return refused("empty word problem");
  const fields = new Map<string, string>();
  for (const part of parts) {
    const match = part.match(
      /^(boxes|each|had|gave|got|groups|extra|ask):([A-Za-z0-9-]+)$/,
    );
    if (!match || fields.has(match[1] ?? "")) {
      return refused("word problem not parsed");
    }
    fields.set(match[1] ?? "", match[2] ?? "");
  }
  const ask = fields.get("ask");
  if (ask !== "total" && ask !== "left")
    return refused("word problem not parsed");
  const read = (key: string): number | null => {
    if (!fields.has(key)) return null;
    const raw = fields.get(key) ?? "";
    if (!/^-?\d+$/.test(raw)) return null;
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || Math.abs(value) > 1000) return null;
    return value;
  };
  const optional = (key: string): number | null =>
    fields.has(key) ? read(key) : 0;
  const boxes = fields.has("boxes");
  const groups = fields.has("groups");
  const had = fields.has("had");
  if ([boxes, groups, had].filter(Boolean).length !== 1) {
    return refused("word problem not parsed");
  }
  let value = 0;
  if (ask === "total" && boxes) {
    if (fields.has("gave") || fields.has("got") || fields.has("extra")) {
      return refused("word problem not parsed");
    }
    const count = read("boxes");
    const each = read("each");
    if (count === null || each === null)
      return refused("word problem not parsed");
    value = count * each;
  } else if (ask === "total" && groups) {
    if (fields.has("gave") || fields.has("got")) {
      return refused("word problem not parsed");
    }
    const count = read("groups");
    const each = read("each");
    const extra = optional("extra");
    if (count === null || each === null || extra === null) {
      return refused("word problem not parsed");
    }
    value = count * each + extra;
  } else if (ask === "left" && had) {
    const start = read("had");
    const got = optional("got");
    const gave = optional("gave");
    if (start === null || got === null || gave === null) {
      return refused("word problem not parsed");
    }
    value = start + got - gave;
  } else {
    return refused("word problem not parsed");
  }
  if (!Number.isSafeInteger(value)) return refused("word problem not parsed");
  return { ok: true, value };
}

/**
 * Allowlisted terminal phrases on a virtual fixture tree.
 * pwd, ls, and `echo` plus one word are the whole list.
 * Anything else is refused. This never spawns a process.
 */
export function runTerminalFixture(command: string): {
  readonly spawned: false;
  readonly output: string;
} {
  const trimmed = command.trim();
  if (trimmed === "pwd") return { spawned: false, output: "/fixture" };
  if (trimmed === "ls") return { spawned: false, output: "README notes.txt" };
  const echo = trimmed.match(/^echo\s+(\S+)$/);
  if (echo && !/[;&|`$<>\n]/.test(echo[1] ?? "")) {
    return { spawned: false, output: echo[1] ?? "" };
  }
  return { spawned: false, output: "refused" };
}

export function runMemoryFixture(script: string): string {
  const store = new Map<string, string>();
  let last = "";
  for (const part of script.split(";")) {
    const set = part.match(/^set:([^=]+)=(.*)$/);
    if (set) {
      store.set(set[1] ?? "", set[2] ?? "");
      last = set[2] ?? "";
      continue;
    }
    const get = part.match(/^get:(.+)$/);
    if (get) {
      const key = get[1] ?? "";
      last = store.has(key) ? (store.get(key) ?? "") : "missing";
    }
  }
  return last;
}

export function stepWorld(input: string): string {
  const pos = input.match(/pos=(-?\d+),(-?\d+)/);
  const actions = [...input.matchAll(/action=(right|left|up|down)/g)].map(
    (match) => match[1] ?? "",
  );
  if (!pos || actions.length === 0) return "malformed";
  let x = Number(pos[1]);
  let y = Number(pos[2]);
  for (let index = 0; index < actions.length; index += 1) {
    const action = actions[index];
    const delta =
      action === "right"
        ? [1, 0]
        : action === "left"
          ? [-1, 0]
          : action === "up"
            ? [0, 1]
            : [0, -1];
    const nextX = x + (delta[0] ?? 0);
    const nextY = y + (delta[1] ?? 0);
    if (nextX < 0 || nextY < 0 || nextX > 1 || nextY > 1) {
      return actions.length === 1 ? "blocked" : `blocked-at:${index + 1}`;
    }
    x = nextX;
    y = nextY;
  }
  return `${x},${y}`;
}

const NAMED_TOOLS = new Set(["notes", "search", "calendar"]);

export function nameTool(input: string): {
  readonly status: "named" | "refused" | "malformed";
  readonly called: false;
} {
  if (/^call:/.test(input)) return { status: "refused", called: false };
  const match = input.match(/^tool:([a-z]+)$/);
  if (!match) return { status: "malformed", called: false };
  return {
    status: NAMED_TOOLS.has(match[1] ?? "") ? "named" : "refused",
    called: false,
  };
}

/**
 * Parse one statement. No driver is loaded and `connected` stays false.
 * Only the literal fixture `select 1` yields a row.
 */
export function parseStatement(input: string): {
  readonly kind: "select" | "refused";
  readonly connected: false;
  readonly detail: "1" | "parsed" | "refused";
} {
  const text = input.trim();
  const refused = {
    kind: "refused" as const,
    connected: false as const,
    detail: "refused" as const,
  };
  if (!text || /[;]|--|\/\*|\*\//.test(text)) return refused;
  if (/^(insert|update|delete|drop|alter|create|grant|copy)\b/i.test(text)) {
    return refused;
  }
  const match = text.match(
    /^select\s+(.+?)(?:\s+from\s+([a-z_][a-z0-9_]*))?(?:\s+where\s+([a-z_][a-z0-9_]*)\s*=\s*(\d+))?$/i,
  );
  if (!match) return refused;
  const columns = (match[1] ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  if (
    columns.length === 0 ||
    columns.some((column) => !/^(\*|\d+|[a-z_][a-z0-9_]*)$/i.test(column))
  ) {
    return refused;
  }
  if (
    columns.length === 1 &&
    columns[0] === "1" &&
    match[2] === undefined &&
    match[3] === undefined
  ) {
    return { kind: "select", connected: false, detail: "1" };
  }
  return { kind: "select", connected: false, detail: "parsed" };
}

/** Dry-run stays local. Live, apply, provision, and deploy are refused. */
export function dryRunPlan(input: string): "dry-run" | "refused" | "unknown" {
  const text = input.trim();
  if (/\b(apply|provision|deploy|live)\b/i.test(text)) return "refused";
  if (
    text === "dry-run" ||
    /^dry-run\b/i.test(text) ||
    /^mode=dry-run\b/i.test(text)
  ) {
    return "dry-run";
  }
  return "unknown";
}

/** Directed edges on fixture ids. A back edge, including a self-loop, is a cycle. */
export function dependencyCycle(
  input: string,
): "acyclic" | "cycle" | "malformed" {
  const body = input.match(/^edges:(.+)$/)?.[1];
  if (!body) return "malformed";
  const edges = body
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  if (edges.length === 0) return "malformed";
  const next = new Map<string, string[]>();
  const nodes = new Set<string>();
  for (const edge of edges) {
    const match = edge.match(/^([a-z][a-z0-9]*)>([a-z][a-z0-9]*)$/);
    if (!match) return "malformed";
    const from = match[1] ?? "";
    const to = match[2] ?? "";
    nodes.add(from);
    nodes.add(to);
    const list = next.get(from) ?? [];
    list.push(to);
    next.set(from, list);
  }
  const color = new Map<string, 0 | 1 | 2>();
  const visit = (node: string): boolean => {
    color.set(node, 1);
    for (const dest of next.get(node) ?? []) {
      const state = color.get(dest) ?? 0;
      if (state === 1) return true;
      if (state === 0 && visit(dest)) return true;
    }
    color.set(node, 2);
    return false;
  };
  for (const node of nodes) {
    if ((color.get(node) ?? 0) === 0 && visit(node)) return "cycle";
  }
  return "acyclic";
}

export function classifyRepoPath(
  input: string,
): "missing" | "refused" | "outside" | string {
  const match = input.match(/^repo:(.+)$/);
  if (!match) return "missing";
  const path = match[1] ?? "";
  let decoded = path;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    return "refused";
  }
  const unsafe = (value: string) =>
    value.includes("..") ||
    value.startsWith("/") ||
    value.includes("\\") ||
    value.includes("\0") ||
    /%2e/i.test(value);
  if (unsafe(path) || unsafe(decoded)) return "refused";
  if (!decoded.startsWith("fixture/") || decoded.includes("//"))
    return "outside";
  return decoded;
}

export function checkCitation(input: string): {
  readonly detail: string;
  readonly id: string | null;
} {
  if (/https?:/i.test(input)) {
    return { detail: "no fetch in this fixture", id: null };
  }
  const claim = /(?:^|;)claim=/.test(input);
  const id = input.match(/(?:^|;)id=([^;]*)/)?.[1]?.trim() ?? "";
  const title = input.match(/(?:^|;)title=([^;]*)/)?.[1]?.trim() ?? "";
  if (claim && !id) return { detail: "missing-id", id: null };
  if (!id || !title) {
    return { detail: "citation missing id or title", id: id || null };
  }
  return { detail: id, id };
}

export function reactionBalance(
  input: string,
): "balanced" | "unbalanced" | "not-reaction" {
  const sides = input.split("->");
  if (sides.length !== 2) return "not-reaction";
  const tally = (side: string): Map<string, number> | null => {
    const terms = side
      .split("+")
      .map((part) => part.trim())
      .filter((part) => part.length > 0);
    if (terms.length === 0) return null;
    const totals = new Map<string, number>();
    for (const term of terms) {
      const match = term.match(/^(\d+)?([A-Z].*)$/);
      if (!match) return null;
      const coeff = match[1] ? Number(match[1]) : 1;
      const counts = formulaCounts(match[2] ?? "");
      if (!counts || !Number.isInteger(coeff) || coeff <= 0) return null;
      for (const part of counts.split(",")) {
        const [symbol, amount] = part.split(":");
        if (!symbol || !amount) return null;
        totals.set(symbol, (totals.get(symbol) ?? 0) + coeff * Number(amount));
      }
    }
    return totals;
  };
  const left = tally(sides[0] ?? "");
  const right = tally(sides[1] ?? "");
  if (!left || !right) return "not-reaction";
  const symbols = new Set([...left.keys(), ...right.keys()]);
  for (const symbol of symbols) {
    if ((left.get(symbol) ?? 0) !== (right.get(symbol) ?? 0)) {
      return "unbalanced";
    }
  }
  return "balanced";
}

export function independentExpected(
  input: string,
): "match" | "mismatch" | "refused" | null {
  const structured = /(?:^|;)(?:expr|claimed)=/.test(input);
  if (!structured) return null;
  const expr = input.match(/(?:^|;)expr=([^;]*)/)?.[1];
  const expect = input.match(/(?:^|;)expect=([^;]*)/)?.[1];
  const claimed = input.match(/(?:^|;)claimed=([^;]*)/)?.[1];
  if (!expr) return "refused";
  const result = evalIntegerExpr(expr);
  if (!result.ok) return "refused";
  const value = String(result.value);
  if (expect !== undefined && expect.trim() !== value) return "mismatch";
  if (claimed !== undefined && claimed.trim() !== value) return "mismatch";
  if (expect === undefined && claimed === undefined) return "refused";
  return "match";
}

export function readPlan(input: string): {
  readonly count: number;
  readonly executed: 0;
  readonly skipped: string | null;
  readonly complete: boolean;
  readonly mode: "count" | "required";
} {
  if (input.startsWith("need:")) {
    const match = input.match(/^need:([^;]*);steps:(.*)$/);
    if (!match) {
      return {
        count: 0,
        executed: 0,
        skipped: null,
        complete: false,
        mode: "required",
      };
    }
    const required = (match[1] ?? "")
      .split(",")
      .map((part) => part.trim())
      .filter((part) => part.length > 0);
    const steps = (match[2] ?? "")
      .split(".")
      .map((part) => part.trim())
      .filter((part) => part.length > 0);
    const skipped = required.find((step) => !steps.includes(step)) ?? null;
    return {
      count: steps.length,
      executed: 0,
      skipped,
      complete: skipped === null && required.length > 0,
      mode: "required",
    };
  }
  const recorded = countRecordedSteps(input);
  return {
    count: recorded.count,
    executed: 0,
    skipped: null,
    complete: false,
    mode: "count",
  };
}

export function readStrategy(input: string):
  | {
      readonly ok: true;
      readonly choice: string;
      readonly rejected: string;
      readonly executed: 0;
    }
  | {
      readonly ok: false;
      readonly detail: "missing-alternative" | "not-alternative" | "malformed";
    } {
  const choice = input.match(/(?:^|;)choose:([^;]*)/)?.[1]?.trim() ?? "";
  const rejected = input.match(/(?:^|;)reject:([^;]*)/)?.[1]?.trim() ?? "";
  if (!choice || !/^[a-z][a-z0-9-]*$/.test(choice)) {
    return { ok: false, detail: "malformed" };
  }
  if (!rejected) return { ok: false, detail: "missing-alternative" };
  if (!/^[a-z][a-z0-9-]*$/.test(rejected)) {
    return { ok: false, detail: "malformed" };
  }
  if (choice === rejected) return { ok: false, detail: "not-alternative" };
  return { ok: true, choice, rejected, executed: 0 };
}

const FIXTURE_CONTEXT = 8;

function contextArch(): FixtureArch {
  return {
    family: "dense-rope",
    vocab: 8,
    dim: 4,
    heads: 2,
    kvHeads: 1,
    ffn: 8,
    experts: 1,
    context: FIXTURE_CONTEXT,
    precision: "fp64-fixture",
  };
}

export function gradeDomain(
  grader: DomainGrader,
  sample: { input: string; target: string },
): { passed: boolean; detail: string } {
  if (grader === "entail") {
    const verdict = entailQuery(sample.input);
    return {
      passed: verdict === sample.target,
      detail: verdict,
    };
  }
  if (grader === "math-expr") {
    if (/(?:^|;)ask:/.test(sample.input)) {
      const word = evalWordProblem(sample.input);
      if (!word.ok) {
        return { passed: sample.target === "refused", detail: word.detail };
      }
      return {
        passed: String(word.value) === sample.target,
        detail: String(word.value),
      };
    }
    const result = evalIntegerExpr(sample.input);
    if (!result.ok) {
      return { passed: sample.target === "refused", detail: result.detail };
    }
    return {
      passed: String(result.value) === sample.target,
      detail: String(result.value),
    };
  }
  if (grader === "logic") {
    const result = evalLogic(sample.input);
    if (!result.ok) return { passed: false, detail: result.detail };
    return {
      passed: String(result.value) === sample.target,
      detail: String(result.value),
    };
  }
  if (grader === "formula") {
    if (sample.input.includes("->")) {
      const verdict = reactionBalance(sample.input);
      return { passed: verdict === sample.target, detail: verdict };
    }
    const counts = formulaCounts(sample.input);
    if (!counts) {
      return {
        passed: sample.target === "unparsed",
        detail: "formula not parsed",
      };
    }
    return { passed: counts === sample.target, detail: counts };
  }
  if (grader === "sum") {
    const total = sumList(sample.input);
    return {
      passed: total !== null && String(total) === sample.target,
      detail: total === null ? "non-integer list" : String(total),
    };
  }
  if (grader === "citation") {
    const check = checkCitation(sample.input);
    if (check.detail === "no fetch in this fixture") {
      return { passed: false, detail: check.detail };
    }
    if (check.detail === "missing-id") {
      return { passed: sample.target === "missing-id", detail: "missing-id" };
    }
    if (!check.id) return { passed: false, detail: check.detail };
    return { passed: check.id === sample.target, detail: check.id };
  }
  if (grader === "context-bound") {
    const count = Number(sample.input);
    if (!Number.isInteger(count) || count < 1) {
      return {
        passed: sample.target === "refused",
        detail: "context length is not an integer",
      };
    }
    const params = initParams(contextArch(), 2);
    const tokens = Array.from({ length: count }, (_, token) => token % 8);
    if (count > FIXTURE_CONTEXT) {
      try {
        forwardTokens(params, tokens);
        return { passed: false, detail: "forward accepted a long sequence" };
      } catch (error) {
        const detail = error instanceof Error ? error.message : "refused";
        return { passed: sample.target === "exceeds", detail };
      }
    }
    forwardTokens(params, tokens);
    return {
      passed: sample.target === "fits",
      detail: "within fixture context",
    };
  }
  if (grader === "memory") {
    const value = runMemoryFixture(sample.input);
    return { passed: value === sample.target, detail: value || "empty" };
  }
  if (grader === "independent") {
    const computed = independentExpected(sample.input);
    if (computed) {
      return { passed: computed === sample.target, detail: computed };
    }
    const left = sample.input.match(/left=([^;]*)/)?.[1];
    const right = sample.input.match(/right=([^;]*)/)?.[1];
    if (left === undefined || right === undefined) {
      return { passed: false, detail: "missing sides" };
    }
    const verdict = left === right ? "same" : "different";
    return { passed: verdict === sample.target, detail: verdict };
  }
  if (grader === "plan") {
    const recorded = readPlan(sample.input);
    if (recorded.mode === "required") {
      if (sample.target.startsWith("skipped:")) {
        const name = sample.target.slice("skipped:".length);
        return {
          passed: recorded.executed === 0 && recorded.skipped === name,
          detail: `skipped ${recorded.skipped ?? "none"}, 0 executed`,
        };
      }
      return {
        passed:
          recorded.executed === 0 &&
          recorded.complete &&
          sample.target === "complete",
        detail: recorded.complete
          ? "required steps recorded, 0 executed"
          : `skipped ${recorded.skipped ?? "unknown"}, 0 executed`,
      };
    }
    const passed =
      recorded.executed === 0 && String(recorded.count) === sample.target;
    return {
      passed,
      detail: `${recorded.count} recorded, ${recorded.executed} executed`,
    };
  }
  if (grader === "horizon") {
    const recorded = readHorizon(sample.input);
    if (recorded.malformed) {
      return {
        passed: sample.target === "malformed",
        detail: "horizon record malformed, 0 executed, not scored",
      };
    }
    if (sample.target.startsWith("failed-at:")) {
      const at = Number(sample.target.slice("failed-at:".length));
      const passed =
        recorded.scored === false &&
        recorded.executed === 0 &&
        recorded.failedAt === at;
      return {
        passed,
        detail: `${recorded.count} recorded, failed at ${recorded.failedAt ?? "none"}, 0 executed, not scored`,
      };
    }
    const passed =
      recorded.failedAt === null &&
      recorded.executed === 0 &&
      String(recorded.count) === sample.target;
    return {
      passed,
      detail: `${recorded.count} recorded, ${recorded.executed} executed, not scored`,
    };
  }
  if (grader === "thinking") {
    const label = classifyThinking(sample.input);
    return { passed: label === sample.target, detail: label };
  }
  if (grader === "terminal") {
    const result = runTerminalFixture(sample.input);
    return {
      passed: result.spawned === false && result.output === sample.target,
      detail: result.output,
    };
  }
  if (grader === "rsi") return gradeRsiSample(sample);
  if (grader === "database") {
    const parsed = parseStatement(sample.input);
    return {
      passed: parsed.connected === false && parsed.detail === sample.target,
      detail: `${parsed.detail}, connected=false`,
    };
  }
  if (grader === "dry-run") {
    const verdict = dryRunPlan(sample.input);
    if (verdict === "unknown") {
      return { passed: false, detail: "unknown dry-run fixture" };
    }
    return {
      passed: verdict === sample.target,
      detail: verdict === "refused" ? "refused live change" : "dry-run only",
    };
  }
  if (grader === "tool") {
    const named = nameTool(sample.input);
    return {
      passed: named.called === false && named.status === sample.target,
      detail: `${named.status}, called=false`,
    };
  }
  if (grader === "world") {
    const next = stepWorld(sample.input);
    return { passed: next === sample.target, detail: next };
  }
  if (grader === "multimodal") {
    if (sample.input === "no-encoder") {
      return {
        passed: sample.target === "unavailable",
        detail: "no encoder in the CPU fixture",
      };
    }
    if (sample.input.startsWith("encoder:")) {
      return {
        passed: sample.target === "refused",
        detail: "no encoder in the CPU fixture",
      };
    }
    return { passed: false, detail: "the fixture has no encoder to claim" };
  }
  if (grader === "repository") {
    const verdict = classifyRepoPath(sample.input);
    if (verdict === "missing") {
      return { passed: false, detail: "missing repo id" };
    }
    if (verdict === "refused") {
      return { passed: sample.target === "refused", detail: "path refused" };
    }
    if (verdict === "outside") {
      return {
        passed: sample.target === "outside",
        detail: "outside fixture",
      };
    }
    return { passed: verdict === sample.target, detail: verdict };
  }
  if (grader === "graph") {
    const verdict = dependencyCycle(sample.input);
    return { passed: verdict === sample.target, detail: verdict };
  }
  if (grader === "strategy") {
    const choice = readStrategy(sample.input);
    if (!choice.ok) {
      return {
        passed: choice.detail === sample.target,
        detail: `${choice.detail}, 0 executed`,
      };
    }
    return {
      passed: choice.executed === 0 && choice.choice === sample.target,
      detail: `chose ${choice.choice}, rejected ${choice.rejected}, 0 executed`,
    };
  }
  return { passed: false, detail: "domain grader was not handled" };
}
