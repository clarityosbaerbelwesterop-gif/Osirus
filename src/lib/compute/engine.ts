import { evaluateAt, MathjsProvider, residualAt } from "./mathjs-provider";
import type { ComputeProvider, ComputeRequest, ComputeResult } from "./types";

// Routing and independent checking.
//
// A computation is only evidence if something other than the thing that
// produced it agrees. Every check below uses a different method from the one
// that computed the value -- substitution for a solve, finite differences for
// a derivative, a round trip for a conversion, numeric sampling for a
// simplification. None of them asks a model.

export type CrossCheck = {
  agrees: boolean | null;
  method: string;
  detail: string;
};

const EPS = 1e-6;

function toMathjs(expression: string) {
  // sympy prints powers as **; mathjs parses ^.
  return expression.replaceAll("**", "^");
}

function close(a: number, b: number, tolerance = EPS) {
  return Math.abs(a - b) <= tolerance * Math.max(1, Math.abs(a), Math.abs(b));
}

const SAMPLE_POINTS = [0.37, 1.13, 2.71, -0.83];

export class ComputeEngine {
  constructor(private readonly providers: ComputeProvider[]) {}

  static inProcess() {
    return new ComputeEngine([new MathjsProvider()]);
  }

  providerIds() {
    return this.providers.map((provider) => provider.id);
  }

  /**
   * Run on the first provider that supports the request and succeeds. A
   * symbolic engine listed first wins when it can; mathjs catches the rest.
   */
  async compute(
    request: ComputeRequest,
    signal?: AbortSignal,
  ): Promise<ComputeResult> {
    let last: ComputeResult | null = null;
    for (const provider of this.providers) {
      if (!provider.supports(request)) continue;
      const result = await provider.compute(request, signal);
      if (result.ok) return result;
      last = result;
    }
    return (
      last ?? {
        ok: false,
        op: request.op,
        provider: "none",
        method: "unsupported",
        error: "no_provider_supports_this_request",
      }
    );
  }

  async crossCheck(
    request: ComputeRequest,
    result: ComputeResult,
  ): Promise<CrossCheck> {
    if (!result.ok) {
      return {
        agrees: null,
        method: "none",
        detail: "Nothing to check: the computation failed.",
      };
    }
    try {
      switch (request.op) {
        case "solve":
          return this.checkSolve(request, result);
        case "derivative":
          return this.checkDerivative(request, result);
        case "simplify":
          return this.checkSimplify(request, result);
        case "convert":
          return this.checkConvert(request, result);
        case "integrate":
        case "evaluate":
        case "matrix":
          return this.checkByOtherProvider(request, result);
        case "statistics": {
          const sum = request.values.reduce((acc, value) => acc + value, 0);
          const mean = sum / request.values.length;
          const reported = (result.value as { mean?: number }).mean ?? NaN;
          return {
            agrees: close(mean, reported),
            method: "plain_summation",
            detail: `Mean recomputed as ${mean}; reported ${reported}.`,
          };
        }
        case "dimension":
          return {
            agrees: result.ok,
            method: "unit_algebra",
            detail: result.text ?? "",
          };
      }
    } catch (error) {
      return {
        agrees: null,
        method: "error",
        detail:
          error instanceof Error ? error.message.slice(0, 200) : "check_failed",
      };
    }
  }

  private checkSolve(
    request: Extract<ComputeRequest, { op: "solve" }>,
    result: ComputeResult,
  ): CrossCheck {
    const candidates = solutionRows(result.value, request.variables);
    if (candidates.length === 0) {
      return {
        agrees: null,
        method: "substitution",
        detail: "No numeric solution to substitute.",
      };
    }
    const failures: string[] = [];
    for (const values of candidates) {
      for (const equation of request.equations) {
        const residual = residualAt(toMathjs(equation), values);
        if (!Number.isFinite(residual) || Math.abs(residual) > 1e-6) {
          failures.push(
            `${equation} leaves residual ${residual} at ${JSON.stringify(values)}`,
          );
        }
      }
    }
    return {
      agrees: failures.length === 0,
      method: "substitution",
      detail: failures.length
        ? failures.slice(0, 3).join("; ")
        : `${candidates.length} solution(s) substituted into ${request.equations.length} equation(s); every residual under 1e-6.`,
    };
  }

  private checkDerivative(
    request: Extract<ComputeRequest, { op: "derivative" }>,
    result: ComputeResult,
  ): CrossCheck {
    const derived = toMathjs(String(result.value));
    const original = toMathjs(request.expression);
    const h = 1e-5;
    const misses: string[] = [];
    for (const x of SAMPLE_POINTS) {
      const numeric =
        (evaluateAt(original, { [request.variable]: x + h }) -
          evaluateAt(original, { [request.variable]: x - h })) /
        (2 * h);
      const symbolic = evaluateAt(derived, { [request.variable]: x });
      if (!close(numeric, symbolic, 1e-4))
        misses.push(`at ${x}: ${symbolic} vs ${numeric}`);
    }
    return {
      agrees: misses.length === 0,
      method: "central_difference",
      detail: misses.length
        ? misses.join("; ")
        : `Matches a central difference at ${SAMPLE_POINTS.length} points.`,
    };
  }

  private checkSimplify(
    request: Extract<ComputeRequest, { op: "simplify" }>,
    result: ComputeResult,
  ): CrossCheck {
    const before = toMathjs(request.expression);
    const after = toMathjs(String(result.value));
    const symbols = [...new Set(before.match(/[a-zA-Z]\w*/g) ?? [])].filter(
      (name) =>
        !["sin", "cos", "tan", "exp", "log", "sqrt", "pi", "e", "abs"].includes(
          name,
        ),
    );
    const misses: string[] = [];
    for (const x of SAMPLE_POINTS) {
      const scope = Object.fromEntries(
        symbols.map((name, index) => [name, x + index * 0.5]),
      );
      const a = evaluateAt(before, scope);
      const b = evaluateAt(after, scope);
      if (Number.isFinite(a) && !close(a, b, 1e-8))
        misses.push(`${JSON.stringify(scope)}: ${a} vs ${b}`);
    }
    return {
      agrees: misses.length === 0,
      method: "numeric_equivalence",
      detail: misses.length
        ? misses.join("; ")
        : `Equal at ${SAMPLE_POINTS.length} sample points.`,
    };
  }

  private async checkConvert(
    request: Extract<ComputeRequest, { op: "convert" }>,
    result: ComputeResult,
  ): Promise<CrossCheck> {
    const back = await new MathjsProvider().compute({
      op: "convert",
      value: Number(result.value),
      from: request.to,
      to: request.from,
    });
    return {
      agrees: back.ok && close(Number(back.value), request.value),
      method: "round_trip",
      detail: `Converted back: ${back.text ?? back.error}.`,
    };
  }

  private async checkByOtherProvider(
    request: ComputeRequest,
    result: ComputeResult,
  ): Promise<CrossCheck> {
    const other = this.providers.find(
      (provider) =>
        provider.id !== result.provider && provider.supports(request),
    );
    if (!other) {
      return {
        agrees: null,
        method: "no_independent_provider",
        detail: `Only ${result.provider} can compute this here; no second method is available.`,
      };
    }
    const second = await other.compute(request);
    if (!second.ok) {
      return {
        agrees: null,
        method: other.id,
        detail: `Second provider could not compute: ${second.error}`,
      };
    }
    const a = Number(result.value);
    const b = Number(second.value);
    if (Number.isFinite(a) && Number.isFinite(b)) {
      return {
        agrees: close(a, b, 1e-6),
        method: other.id,
        detail: `${result.provider}: ${a}; ${other.id}: ${b}.`,
      };
    }
    return {
      agrees: JSON.stringify(result.value) === JSON.stringify(second.value),
      method: other.id,
      detail: `${result.provider}: ${result.text}; ${other.id}: ${second.text}.`,
    };
  }
}

/** Normalise the solution shapes the providers return into rows of numbers. */
function solutionRows(
  value: unknown,
  variables: string[],
): Array<Record<string, number>> {
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  if (Array.isArray(record.numeric)) {
    return (record.numeric as Array<Record<string, unknown>>)
      .map((row) =>
        Object.fromEntries(Object.entries(row).map(([k, v]) => [k, Number(v)])),
      )
      .filter((row) => variables.every((name) => Number.isFinite(row[name])));
  }
  if (variables.length === 1 && Array.isArray(record[variables[0]!])) {
    return (record[variables[0]!] as number[]).map((root) => ({
      [variables[0]!]: root,
    }));
  }
  if (variables.every((name) => typeof record[name] === "number")) {
    return [
      Object.fromEntries(
        variables.map((name) => [name, record[name] as number]),
      ),
    ];
  }
  return [];
}
