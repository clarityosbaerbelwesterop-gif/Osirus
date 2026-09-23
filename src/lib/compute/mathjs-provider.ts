import {
  all,
  create,
  type MathJsInstance,
  type Matrix,
  type Unit,
} from "mathjs";
import type { ComputeProvider, ComputeRequest, ComputeResult } from "./types";

// In-process computation on mathjs.
//
// mathjs has its own parser and evaluator; no expression reaches JavaScript's
// eval. Its documentation still warns that an expression can call back into
// functions like import() or createUnit() to change the instance, or into
// evaluate() and parse() to build unbounded work, so those are replaced with
// functions that refuse -- the hardening mathjs itself recommends for
// untrusted input.
//
// What mathjs cannot do is solve non-linear equations or integrate
// symbolically. Those are attempted numerically here and marked exact: false,
// or left to the sandboxed Python provider, which has sympy.

const math: MathJsInstance = create(all, { number: "number", precision: 64 });

// Keep references to the functions this module needs before the expression
// namespace is locked down.
const evaluate = math.evaluate.bind(math);
const parse = math.parse.bind(math);
const simplify = math.simplify.bind(math);
const derivative = math.derivative.bind(math);

const refused = (name: string) => () => {
  throw new Error(`function_disabled:${name}`);
};
math.import(
  {
    import: refused("import"),
    createUnit: refused("createUnit"),
    evaluate: refused("evaluate"),
    parse: refused("parse"),
    simplify: refused("simplify"),
    derivative: refused("derivative"),
    resolve: refused("resolve"),
    reviver: refused("reviver"),
  },
  { override: true },
);

const TOLERANCE = 1e-9;

function format(value: unknown): string {
  try {
    return math.format(value as never, { precision: 14 });
  } catch {
    return String(value);
  }
}

function isUnit(value: unknown): value is Unit {
  return math.isUnit(value);
}

function splitEquation(equation: string): string {
  const parts = equation.split("=");
  if (parts.length === 1) return equation;
  if (parts.length !== 2) throw new Error("equation_must_have_one_equals_sign");
  return `(${parts[0]}) - (${parts[1]})`;
}

/**
 * Solve a system that is linear in its variables by building the coefficient
 * matrix from symbolic derivatives and solving it exactly-as-floats.
 */
function solveLinear(equations: string[], variables: string[]) {
  const residuals = equations.map((equation) => parse(splitEquation(equation)));
  const zeros = Object.fromEntries(variables.map((name) => [name, 0]));
  const A: number[][] = [];
  const b: number[] = [];
  for (const residual of residuals) {
    const row: number[] = [];
    for (const variable of variables) {
      const coefficient = derivative(residual, variable);
      // Linear means every coefficient is constant. A coefficient that still
      // mentions a variable means the system is not linear in it.
      const symbols = new Set<string>();
      coefficient.traverse((node) => {
        if (node.type === "SymbolNode")
          symbols.add((node as unknown as { name: string }).name);
      });
      if (variables.some((name) => symbols.has(name))) return null;
      row.push(Number(coefficient.evaluate({})));
    }
    A.push(row);
    b.push(-Number(residual.evaluate(zeros)));
  }
  if (A.length !== variables.length) return null;
  const solution = math.lusolve(A, b) as number[][];
  return Object.fromEntries(
    variables.map((name, index) => [name, solution[index]![0]!]),
  );
}

/** One variable, non-linear: bracket scan then bisection. Numeric by design. */
function solveNumeric(equation: string, variable: string) {
  const f = parse(splitEquation(equation)).compile();
  const at = (x: number) => Number(f.evaluate({ [variable]: x }));
  const roots: number[] = [];
  const lo = -1000;
  const hi = 1000;
  const steps = 4000;
  let previousX = lo;
  let previous = at(lo);
  for (let i = 1; i <= steps; i += 1) {
    const x = lo + ((hi - lo) * i) / steps;
    const y = at(x);
    if (!Number.isFinite(y) || !Number.isFinite(previous)) {
      previousX = x;
      previous = y;
      continue;
    }
    if (Math.abs(y) < TOLERANCE) roots.push(x);
    else if (previous * y < 0) {
      let a = previousX;
      let bValue = x;
      for (let k = 0; k < 200; k += 1) {
        const mid = (a + bValue) / 2;
        const m = at(mid);
        if (at(a) * m <= 0) bValue = mid;
        else a = mid;
      }
      roots.push((a + bValue) / 2);
    }
    previousX = x;
    previous = y;
  }
  const unique = roots
    .map((root) => Number(root.toPrecision(12)))
    .filter(
      (root, index, all) =>
        all.findIndex((other) => Math.abs(other - root) < 1e-7) === index,
    );
  return unique.slice(0, 20);
}

function simpson(
  expression: string,
  variable: string,
  lower: number,
  upper: number,
) {
  const f = parse(expression).compile();
  const n = 2000;
  const h = (upper - lower) / n;
  let sum = 0;
  for (let i = 0; i <= n; i += 1) {
    const x = lower + i * h;
    const weight = i === 0 || i === n ? 1 : i % 2 === 1 ? 4 : 2;
    sum += weight * Number(f.evaluate({ [variable]: x }));
  }
  return (sum * h) / 3;
}

export class MathjsProvider implements ComputeProvider {
  readonly id = "mathjs";

  supports(request: ComputeRequest) {
    // Indefinite integrals need a symbolic engine.
    return !(
      request.op === "integrate" &&
      (request.lower === undefined || request.upper === undefined)
    );
  }

  async compute(request: ComputeRequest): Promise<ComputeResult> {
    const base = { op: request.op, provider: this.id } as const;
    try {
      switch (request.op) {
        case "evaluate": {
          const value = evaluate(request.expression, {
            ...(request.scope ?? {}),
          });
          if (isUnit(value)) {
            return {
              ...base,
              ok: true,
              value: value.toNumber(),
              text: format(value),
              unit: value.formatUnits(),
              exact: false,
              method: "mathjs.evaluate",
            };
          }
          return {
            ...base,
            ok: true,
            value: typeof value === "number" ? value : format(value),
            text: format(value),
            exact: false,
            method: "mathjs.evaluate",
          };
        }
        case "simplify": {
          const node = simplify(request.expression);
          return {
            ...base,
            ok: true,
            value: node.toString(),
            text: node.toString(),
            exact: true,
            method: "mathjs.simplify",
          };
        }
        case "derivative": {
          const node = derivative(request.expression, request.variable);
          return {
            ...base,
            ok: true,
            value: node.toString(),
            text: node.toString(),
            exact: true,
            method: "mathjs.derivative",
          };
        }
        case "integrate": {
          const value = simpson(
            request.expression,
            request.variable,
            request.lower!,
            request.upper!,
          );
          return {
            ...base,
            ok: true,
            value,
            text: format(value),
            exact: false,
            method: "simpson_2000",
          };
        }
        case "solve": {
          const linear = solveLinear(request.equations, request.variables);
          if (linear) {
            return {
              ...base,
              ok: true,
              value: linear,
              text: Object.entries(linear)
                .map(([name, value]) => `${name} = ${format(value)}`)
                .join(", "),
              exact: false,
              method: "linear_system_lu",
            };
          }
          if (
            request.equations.length === 1 &&
            request.variables.length === 1
          ) {
            const roots = solveNumeric(
              request.equations[0]!,
              request.variables[0]!,
            );
            return {
              ...base,
              ok: roots.length > 0,
              value: { [request.variables[0]!]: roots },
              text: roots.length
                ? `${request.variables[0]} ∈ {${roots.map(format).join(", ")}}`
                : "no real root found in [-1000, 1000]",
              exact: false,
              method: "bracket_bisection",
              error: roots.length ? undefined : "no_real_root_in_scan_range",
            };
          }
          return {
            ...base,
            ok: false,
            method: "unsupported",
            error: "non_linear_system_needs_symbolic_solver",
          };
        }
        case "matrix": {
          const a = math.matrix(request.a);
          const b = request.b ? math.matrix(request.b) : undefined;
          let value: unknown;
          switch (request.operation) {
            case "multiply":
              if (!b) throw new Error("matrix_multiply_needs_b");
              value = (math.multiply(a, b) as Matrix).toArray();
              break;
            case "inverse":
              value = (math.inv(a) as Matrix).toArray();
              break;
            case "determinant":
              value = math.det(a);
              break;
            case "transpose":
              value = (math.transpose(a) as Matrix).toArray();
              break;
            case "solve":
              if (!b) throw new Error("matrix_solve_needs_b");
              value = (math.lusolve(a, b) as Matrix).valueOf();
              break;
          }
          return {
            ...base,
            ok: true,
            value,
            text: format(value),
            exact: false,
            method: `mathjs.${request.operation}`,
          };
        }
        case "statistics": {
          const values = request.values;
          const sorted = [...values].sort((x, y) => x - y);
          const value = {
            count: values.length,
            mean: math.mean(values),
            median: math.median(values),
            std: values.length > 1 ? math.std(values) : 0,
            variance: values.length > 1 ? math.variance(values) : 0,
            min: sorted[0],
            max: sorted[sorted.length - 1],
            sum: math.sum(values),
          };
          return {
            ...base,
            ok: true,
            value,
            text: JSON.stringify(value),
            exact: false,
            method: "mathjs.statistics",
          };
        }
        case "convert": {
          const converted = math
            .unit(request.value, request.from)
            .to(request.to);
          return {
            ...base,
            ok: true,
            value: converted.toNumber(request.to),
            text: format(converted),
            unit: request.to,
            exact: false,
            method: "mathjs.unit.to",
          };
        }
        case "dimension": {
          const value = evaluate(request.expression);
          if (!isUnit(value)) {
            return {
              ...base,
              ok: true,
              value: "dimensionless",
              text: format(value),
              unit: "",
              exact: false,
              method: "mathjs.unit",
            };
          }
          if (request.expectUnit) {
            const expected = math.unit(1, request.expectUnit);
            const compatible = value.equalBase(expected);
            return {
              ...base,
              ok: compatible,
              value: compatible ? value.toNumber(request.expectUnit) : null,
              text: compatible
                ? format(value.to(request.expectUnit))
                : `${value.formatUnits()} is not compatible with ${request.expectUnit}`,
              unit: compatible ? request.expectUnit : value.formatUnits(),
              exact: false,
              method: "mathjs.unit.equalBase",
              error: compatible ? undefined : "dimension_mismatch",
            };
          }
          return {
            ...base,
            ok: true,
            value: value.toNumber(),
            text: format(value),
            unit: value.formatUnits(),
            exact: false,
            method: "mathjs.unit",
          };
        }
      }
    } catch (error) {
      return {
        ...base,
        ok: false,
        method: "error",
        error:
          error instanceof Error
            ? error.message.slice(0, 300)
            : "compute_failed",
      };
    }
  }
}

/** Exposed for verification: evaluate a residual with fixed variable values. */
export function residualAt(equation: string, values: Record<string, number>) {
  return Number(parse(splitEquation(equation)).evaluate(values));
}

/** Exposed for verification: evaluate an expression at a point. */
export function evaluateAt(expression: string, values: Record<string, number>) {
  return Number(parse(expression).evaluate(values));
}
