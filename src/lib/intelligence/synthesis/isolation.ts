import { spawn } from "node:child_process";
import { parse } from "acorn";

// Static analysis and isolated execution for generated tools (M43).
//
// A generated tool is one pure function, `function run(input) { ... }`,
// over JSON in and JSON out. It runs only here, behind four independent
// layers, so no single mistake opens anything:
//
//   1. an AST allowlist (acorn): no imports, no globals beyond pure
//      built-ins, no `constructor`/`__proto__`/`prototype`, no computed
//      member access by string, no async, no generators, no `this`;
//   2. a fresh vm context with no globals from the host and code
//      generation from strings and wasm disabled;
//   3. a separate Node process under the permission model (no fs, no
//      child processes, no workers), with an empty environment and a
//      64 MB heap;
//   4. a per-call timeout and a wall-clock kill of the process.

export const MAX_SOURCE = 6_000;
const MAX_NODES = 2_500;

/** Pure built-ins a generated tool may name. Nothing that reaches outside. */
const ALLOWED_GLOBALS = new Set([
  "Math",
  "Number",
  "String",
  "Boolean",
  "Array",
  "Object",
  "JSON",
  "isFinite",
  "isNaN",
  "parseInt",
  "parseFloat",
  "Infinity",
  "NaN",
  "undefined",
  "Error",
  "RangeError",
  "TypeError",
  "BigInt",
]);

const FORBIDDEN_PROPERTIES = new Set([
  "constructor",
  "__proto__",
  "prototype",
  "__defineGetter__",
  "__defineSetter__",
  "__lookupGetter__",
  "__lookupSetter__",
  "defineProperty",
  "defineProperties",
  "setPrototypeOf",
  "getPrototypeOf",
  "caller",
  "callee",
  "arguments",
]);

const FORBIDDEN_NODES = new Set([
  "ImportExpression",
  "ImportDeclaration",
  "ExportNamedDeclaration",
  "ExportDefaultDeclaration",
  "ExportAllDeclaration",
  "MetaProperty",
  "WithStatement",
  "ThisExpression",
  "Super",
  "ClassDeclaration",
  "ClassExpression",
  "AwaitExpression",
  "YieldExpression",
  "TaggedTemplateExpression",
  "DebuggerStatement",
  "LabeledStatement",
]);

export type StaticReport = { ok: boolean; problems: string[]; nodes: number };

type Node = {
  type: string;
  [key: string]: unknown;
};

/** Reject anything outside the pure-function subset. */
export function analyzeSource(source: string): StaticReport {
  const problems: string[] = [];
  if (source.length > MAX_SOURCE)
    return {
      ok: false,
      problems: [`source over ${MAX_SOURCE} chars`],
      nodes: 0,
    };
  let ast: Node;
  try {
    ast = parse(source, {
      ecmaVersion: 2022,
      sourceType: "script",
    }) as unknown as Node;
  } catch (error) {
    return {
      ok: false,
      problems: [`parse: ${(error as Error).message.slice(0, 120)}`],
      nodes: 0,
    };
  }
  const body = ast.body as Node[];
  if (
    body.length !== 1 ||
    body[0]!.type !== "FunctionDeclaration" ||
    (body[0]!.id as Node | null)?.name !== "run" ||
    (body[0]!.params as Node[]).length !== 1 ||
    body[0]!.async ||
    body[0]!.generator
  )
    problems.push("the source must be exactly `function run(input) { ... }`");

  // Names the function binds itself: parameters, declarations, functions.
  const declared = new Set<string>();
  const bind = (pattern: Node | null | undefined) => {
    if (!pattern) return;
    if (pattern.type === "Identifier") declared.add(pattern.name as string);
    else if (pattern.type === "ObjectPattern")
      for (const property of pattern.properties as Node[])
        bind((property.value ?? property.argument) as Node);
    else if (pattern.type === "ArrayPattern")
      for (const element of pattern.elements as Array<Node | null>)
        bind(element);
    else if (pattern.type === "AssignmentPattern") bind(pattern.left as Node);
    else if (pattern.type === "RestElement") bind(pattern.argument as Node);
  };

  let nodes = 0;
  const identifiers: Array<{ name: string; parent: Node | null; key: string }> =
    [];
  const walk = (node: Node, parent: Node | null, key: string) => {
    nodes += 1;
    if (nodes > MAX_NODES) return;
    if (FORBIDDEN_NODES.has(node.type))
      problems.push(`${node.type} is not allowed`);
    if (
      (node.type === "FunctionDeclaration" ||
        node.type === "FunctionExpression" ||
        node.type === "ArrowFunctionExpression") &&
      (node.async || node.generator)
    )
      problems.push("async and generator functions are not allowed");
    if (
      node.type === "FunctionDeclaration" ||
      node.type === "FunctionExpression"
    ) {
      bind(node.id as Node);
      for (const param of node.params as Node[]) bind(param);
    }
    if (node.type === "ArrowFunctionExpression")
      for (const param of node.params as Node[]) bind(param);
    if (node.type === "VariableDeclarator") bind(node.id as Node);
    if (node.type === "CatchClause") bind(node.param as Node);
    if (
      node.type === "Literal" &&
      typeof node.value === "string" &&
      FORBIDDEN_PROPERTIES.has(node.value)
    )
      problems.push(`the string "${node.value}" is not allowed`);
    if (node.type === "MemberExpression") {
      const property = node.property as Node;
      if (node.computed) {
        const literalNumber =
          property.type === "Literal" && typeof property.value === "number";
        const localIndex = property.type === "Identifier";
        // Index arithmetic only: `i - 1`, `i * 2`, `i + 1` -- never a
        // string built up to reach a property by name.
        const numeric = (side: Node) =>
          side.type === "Identifier" ||
          (side.type === "Literal" && typeof side.value === "number");
        const arithmetic =
          property.type === "UpdateExpression" ||
          (property.type === "BinaryExpression" &&
            ["-", "*", "/", "%", "|", "&", ">>", "<<", ">>>"].includes(
              property.operator as string,
            )) ||
          (property.type === "BinaryExpression" &&
            property.operator === "+" &&
            numeric(property.left as Node) &&
            numeric(property.right as Node) &&
            ((property.left as Node).type === "Literal" ||
              (property.right as Node).type === "Literal"));
        if (!literalNumber && !localIndex && !arithmetic)
          problems.push("computed member access must be by index");
      } else if (FORBIDDEN_PROPERTIES.has(property.name as string))
        problems.push(`property "${String(property.name)}" is not allowed`);
    }
    if (node.type === "Identifier")
      identifiers.push({ name: node.name as string, parent, key });
    for (const [childKey, value] of Object.entries(node)) {
      if (childKey === "type" || childKey === "start" || childKey === "end")
        continue;
      if (Array.isArray(value))
        for (const child of value)
          if (
            child &&
            typeof child === "object" &&
            typeof (child as Node).type === "string"
          )
            walk(child as Node, node, childKey);
      if (
        value &&
        typeof value === "object" &&
        typeof (value as Node).type === "string"
      )
        walk(value as Node, node, childKey);
    }
  };
  walk(ast, null, "");
  if (nodes > MAX_NODES) problems.push(`more than ${MAX_NODES} syntax nodes`);

  for (const { name, parent, key } of identifiers) {
    // Property names and object keys are not references.
    if (
      parent?.type === "MemberExpression" &&
      key === "property" &&
      !parent.computed
    )
      continue;
    if (parent?.type === "Property" && key === "key" && !parent.computed)
      continue;
    if (FORBIDDEN_PROPERTIES.has(name)) {
      problems.push(`identifier "${name}" is not allowed`);
      continue;
    }
    if (declared.has(name) || ALLOWED_GLOBALS.has(name)) continue;
    problems.push(`"${name}" is not a local name or an allowed built-in`);
  }
  return {
    ok: problems.length === 0,
    problems: [...new Set(problems)].slice(0, 20),
    nodes,
  };
}

export type IsolatedCall =
  { ok: true; output: unknown } | { ok: false; error: string };

// The runner inside the restricted process. It reads one JSON payload from
// stdin, evaluates the source once in an empty context without code
// generation, calls run() per input (each input parsed inside the context,
// so no host object is reachable), and checks that nothing polluted the
// context's Object.prototype.
const RUNNER = `
const vm = require("node:vm");
let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => { raw += chunk; });
process.stdin.on("end", () => {
  const { source, inputs, callMs } = JSON.parse(raw);
  const context = vm.createContext(Object.create(null), {
    codeGeneration: { strings: false, wasm: false },
    microtaskMode: "afterEvaluate",
  });
  const results = [];
  const shape = "[Object.getOwnPropertyNames(Object.getPrototypeOf({})).length, Object.getOwnPropertyNames(Object.getPrototypeOf([])).length, Object.getOwnPropertyNames(Object.getPrototypeOf(function () {})).length].join()";
  const baseline = vm.runInContext(shape, context);
  try {
    vm.runInContext(source + "\\n;globalThis.__run = run;", context, { timeout: callMs });
  } catch (error) {
    process.stdout.write(JSON.stringify({ fatal: String(error && error.message || error).slice(0, 200) }));
    return;
  }
  context.__inputs = JSON.stringify(inputs);
  vm.runInContext("globalThis.__all = JSON.parse(__inputs);", context, { timeout: callMs });
  for (let i = 0; i < inputs.length; i += 1) {
    try {
      const out = vm.runInContext(
        "(() => { const r = __run(__all[" + i + "]); if (r && typeof r.then === 'function') throw new Error('asynchronous output not allowed'); return JSON.stringify(r === undefined ? null : r); })()",
        context,
        { timeout: callMs },
      );
      if (typeof out !== "string" || out.length > 200000) throw new Error("output not JSON or too large");
      const polluted = vm.runInContext(shape, context) !== baseline;
      if (polluted) throw new Error("prototype pollution detected");
      results.push({ ok: true, output: JSON.parse(out) });
    } catch (error) {
      results.push({ ok: false, error: String(error && (error.code || error.message) || error).slice(0, 200) });
    }
  }
  process.stdout.write(JSON.stringify({ results }));
});
`;

/**
 * Run a generated tool's source on inputs, isolated. Every failure is a
 * result, never a throw into the caller: a candidate cannot take down the
 * Foundry that is testing it.
 */
export async function runIsolated(
  source: string,
  inputs: unknown[],
  options: { callMs?: number; wallMs?: number } = {},
): Promise<{ fatal: string | null; results: IsolatedCall[] }> {
  const payload = JSON.stringify({
    source,
    inputs,
    callMs: options.callMs ?? 100,
  });
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [
        "--experimental-permission",
        "--max-old-space-size=64",
        "--no-warnings",
        "-e",
        RUNNER,
      ],
      { env: {} as NodeJS.ProcessEnv, stdio: ["pipe", "pipe", "pipe"] },
    );
    let out = "";
    let settled = false;
    const finish = (value: {
      fatal: string | null;
      results: IsolatedCall[];
    }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish({ fatal: "wall-clock limit", results: [] });
    }, options.wallMs ?? 10_000);
    child.stdout.on("data", (chunk) => {
      out += chunk;
      if (out.length > 2_000_000) child.kill("SIGKILL");
    });
    child.on("error", (error) => finish({ fatal: error.message, results: [] }));
    child.on("close", () => {
      try {
        const parsed = JSON.parse(out) as {
          fatal?: string;
          results?: IsolatedCall[];
        };
        finish({ fatal: parsed.fatal ?? null, results: parsed.results ?? [] });
      } catch {
        finish({ fatal: "runner produced no result", results: [] });
      }
    });
    child.stdin.end(payload);
  });
}

/**
 * Programs that must fail in the executor on this host. Run with the
 * static analysis bypassed: they test the isolation itself. If any of them
 * gets through, no generated tool is accepted (fail closed).
 */
export const ISOLATION_PROBES: Array<{ name: string; source: string }> = [
  {
    name: "host globals",
    source:
      "function run(input) { return [typeof process, typeof require, typeof fetch, typeof Buffer]; }",
  },
  {
    name: "code generation",
    source:
      "function run(input) { return ({}).constructor.constructor('return typeof process')(); }",
  },
  { name: "eval", source: "function run(input) { return eval('1 + 1'); }" },
  {
    name: "dynamic import",
    source: "function run(input) { return import('node:fs'); }",
  },
  {
    name: "environment",
    source:
      "function run(input) { return this && this.process ? Object.keys(this.process.env) : null; }",
  },
];

export async function isolationHolds(): Promise<{
  ok: boolean;
  findings: string[];
}> {
  const findings: string[] = [];
  for (const probe of ISOLATION_PROBES) {
    const run = await runIsolated(probe.source, [{}]);
    const result = run.results[0];
    if (probe.name === "host globals") {
      const output = result?.ok ? (result.output as string[]) : null;
      if (!output || output.some((kind) => kind !== "undefined"))
        findings.push(`${probe.name}: ${JSON.stringify(output)}`);
      continue;
    }
    if (probe.name === "environment") {
      if (result?.ok && result.output !== null)
        findings.push(`${probe.name}: reachable`);
      continue;
    }
    if (result?.ok && !run.fatal)
      findings.push(`${probe.name}: ran (${JSON.stringify(result.output)})`);
  }
  return { ok: findings.length === 0, findings };
}
