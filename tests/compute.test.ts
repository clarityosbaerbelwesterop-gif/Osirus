import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { analyzeRows, parseCsv } from "../src/lib/compute/data";
import { ComputeEngine } from "../src/lib/compute/engine";
import { MathjsProvider } from "../src/lib/compute/mathjs-provider";
import { PythonComputeProvider } from "../src/lib/compute/python-provider";
import { computeRequestSchema } from "../src/lib/compute/types";
import { LocalWorkspaceDriver } from "../src/lib/sandbox/local";

const hasSympy =
  spawnSync("python3", ["-c", "import sympy"], { stdio: "ignore" }).status ===
  0;

const mathjs = new MathjsProvider();

describe("mathjs provider", () => {
  it("evaluates with units and converts", async () => {
    const speed = await mathjs.compute({
      op: "evaluate",
      expression: "5 km / 2 h to m/s",
    });
    expect(speed.ok).toBe(true);
    expect(speed.unit).toBe("m / s");
    expect(Number(speed.value)).toBeCloseTo(0.6944444, 6);
  });

  it("rejects a physics result whose dimensions do not match", async () => {
    const ok = await mathjs.compute({
      op: "dimension",
      expression: "10 kg * 9.81 m/s^2",
      expectUnit: "N",
    });
    const bad = await mathjs.compute({
      op: "dimension",
      expression: "10 kg * 9.81 m/s",
      expectUnit: "N",
    });
    expect(ok.ok).toBe(true);
    expect(Number(ok.value)).toBeCloseTo(98.1, 9);
    expect(bad.ok).toBe(false);
    expect(bad.error).toBe("dimension_mismatch");
  });

  it("solves a linear system exactly and a non-linear equation numerically", async () => {
    const linear = await mathjs.compute({
      op: "solve",
      equations: ["2x + y = 5", "x - y = 1"],
      variables: ["x", "y"],
    });
    expect(linear.value).toEqual({ x: 2, y: 1 });
    const roots = await mathjs.compute({
      op: "solve",
      equations: ["x^2 - 2 = 0"],
      variables: ["x"],
    });
    expect(roots.exact).toBe(false);
    expect((roots.value as { x: number[] }).x.map((r) => Math.abs(r))).toEqual(
      [Math.SQRT2, Math.SQRT2].map((v) => Number(v.toPrecision(12))),
    );
  });

  it("differentiates, integrates and works with matrices", async () => {
    expect(
      (
        await mathjs.compute({
          op: "derivative",
          expression: "x^3",
          variable: "x",
        })
      ).value,
    ).toBe("3 * x ^ 2");
    expect(
      Number(
        (
          await mathjs.compute({
            op: "integrate",
            expression: "x^2",
            variable: "x",
            lower: 0,
            upper: 3,
          })
        ).value,
      ),
    ).toBeCloseTo(9, 8);
    expect(
      (
        await mathjs.compute({
          op: "matrix",
          operation: "determinant",
          a: [
            [1, 2],
            [3, 4],
          ],
        })
      ).value,
    ).toBeCloseTo(-2, 12);
  });

  it("refuses the functions that could change or escape the instance", async () => {
    for (const expression of [
      "import(1)",
      "evaluate(1)",
      "createUnit(1)",
      "parse(1)",
    ]) {
      const result = await mathjs.compute({ op: "evaluate", expression });
      expect(result.ok, expression).toBe(false);
      expect(result.error).toMatch(/function_disabled/);
    }
  });

  it("does not claim a symbolic indefinite integral it cannot do", () => {
    expect(
      mathjs.supports({ op: "integrate", expression: "x", variable: "x" }),
    ).toBe(false);
  });
});

describe("compute request validation", () => {
  it("rejects expressions that try to reach beyond math", () => {
    for (const expression of [
      "__import__('os')",
      "x.__class__",
      '"string"',
      "a[0]",
      "{1}",
      "process.exit()",
    ]) {
      expect(
        computeRequestSchema.safeParse({ op: "evaluate", expression }).success,
        expression,
      ).toBe(false);
    }
    expect(
      computeRequestSchema.safeParse({
        op: "evaluate",
        expression: "sin(pi/2) + 3^2",
      }).success,
    ).toBe(true);
  });
});

describe("independent checks", () => {
  const engine = ComputeEngine.inProcess();

  it("verifies a solve by substituting the solution back", async () => {
    const request = {
      op: "solve" as const,
      equations: ["3x - 7 = 11"],
      variables: ["x"],
    };
    const result = await engine.compute(request);
    const check = await engine.crossCheck(request, result);
    expect(check.method).toBe("substitution");
    expect(check.agrees).toBe(true);
  });

  it("catches a wrong solution", async () => {
    const request = {
      op: "solve" as const,
      equations: ["3x - 7 = 11"],
      variables: ["x"],
    };
    const check = await engine.crossCheck(request, {
      ok: true,
      op: "solve",
      provider: "model",
      value: { x: 5 },
      method: "asserted",
    });
    expect(check.agrees).toBe(false);
  });

  it("checks a derivative against a central difference", async () => {
    const request = {
      op: "derivative" as const,
      expression: "sin(x) * x^2",
      variable: "x",
    };
    const good = await engine.crossCheck(
      request,
      await engine.compute(request),
    );
    const bad = await engine.crossCheck(request, {
      ok: true,
      op: "derivative",
      provider: "model",
      value: "cos(x) * 2x",
      method: "asserted",
    });
    expect(good.agrees).toBe(true);
    expect(bad.agrees).toBe(false);
  });

  it("checks a simplification by numeric equivalence", async () => {
    const request = {
      op: "simplify" as const,
      expression: "(x + 1)^2 - x^2 - 2x",
    };
    const good = await engine.crossCheck(
      request,
      await engine.compute(request),
    );
    const bad = await engine.crossCheck(request, {
      ok: true,
      op: "simplify",
      provider: "model",
      value: "2",
      method: "asserted",
    });
    expect(good.agrees).toBe(true);
    expect(bad.agrees).toBe(false);
  });

  it("says when no second method exists instead of pretending to check", async () => {
    const request = { op: "evaluate" as const, expression: "2 + 2" };
    const check = await engine.crossCheck(
      request,
      await engine.compute(request),
    );
    expect(check.agrees).toBeNull();
    expect(check.method).toBe("no_independent_provider");
  });
});

describe.skipIf(!hasSympy)("sympy provider in an isolated workspace", () => {
  const workspace = new LocalWorkspaceDriver();
  let handle: Awaited<ReturnType<LocalWorkspaceDriver["create"]>> | null = null;
  const python = new PythonComputeProvider(
    async () => (handle ??= await workspace.create()),
  );

  it("probes what is installed rather than assuming it", async () => {
    const probe = await python.probe();
    expect(probe.available).toBe(true);
    expect(probe.packages.sympy).toBe(true);
  });

  it("solves a non-linear system symbolically", async () => {
    const result = await python.compute({
      op: "solve",
      equations: ["x^2 + y^2 = 25", "x - y = 1"],
      variables: ["x", "y"],
    });
    expect(result.ok).toBe(true);
    expect(result.exact).toBe(true);
    const engine = new ComputeEngine([python, mathjs]);
    const check = await engine.crossCheck(
      {
        op: "solve",
        equations: ["x^2 + y^2 = 25", "x - y = 1"],
        variables: ["x", "y"],
      },
      result,
    );
    // sympy solved it; mathjs verified it by substitution. Two engines.
    expect(check.agrees).toBe(true);
  });

  it("integrates symbolically where mathjs cannot", async () => {
    const result = await python.compute({
      op: "integrate",
      expression: "x*exp(x)",
      variable: "x",
    });
    expect(result.ok).toBe(true);
    expect(String(result.value).replaceAll(" ", "")).toMatch(
      /\(x-1\)\*exp\(x\)|x\*exp\(x\)-exp\(x\)/,
    );
  });

  it("cross-checks a definite integral between two engines", async () => {
    const engine = new ComputeEngine([python, mathjs]);
    const request = {
      op: "integrate" as const,
      expression: "sin(x)",
      variable: "x",
      lower: 0,
      upper: Math.PI,
    };
    const result = await engine.compute(request);
    const check = await engine.crossCheck(request, result);
    expect(Number(result.value)).toBeCloseTo(2, 9);
    expect(check.method).toBe("mathjs");
    expect(check.agrees).toBe(true);
    await handle?.stop();
  });
});

describe("data analysis", () => {
  const csv = [
    "region,units,price",
    'north,10,"1,000"',
    "south,12,1100",
    "north,11,1050",
    "south,,990",
    'east,"9",1020',
  ].join("\n");

  it("parses quoted fields and embedded commas", () => {
    const rows = parseCsv(csv);
    expect(rows).toHaveLength(5);
    expect(rows[0]).toEqual({ region: "north", units: 10, price: 1000 });
    expect(rows[3]!.units).toBeNull();
  });

  it("summarises, groups and correlates", () => {
    const analysis = analyzeRows(parseCsv(csv), {
      groupBy: "region",
      aggregate: { column: "units", fn: "sum" },
    });
    const units = analysis.columns.find((column) => column.name === "units")!;
    expect(units.type).toBe("number");
    expect(units.missing).toBe(1);
    expect(units.mean).toBeCloseTo(10.5, 9);
    expect(
      analysis.groups!.find((group) => group.key === "north")!.aggregate,
    ).toBe(21);
    expect(analysis.correlations.map((c) => `${c.a}/${c.b}`)).toContain(
      "units/price",
    );
  });

  it("flags an outlier by z-score", () => {
    const rows = Array.from({ length: 40 }, (_, i) => ({ v: 100 + (i % 5) }));
    rows.push({ v: 10_000 });
    const analysis = analyzeRows(rows);
    expect(analysis.anomalies).toHaveLength(1);
    expect(analysis.anomalies[0]!.value).toBe(10_000);
  });
});
