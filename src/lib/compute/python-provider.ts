import type { SandboxHandle } from "../sandbox/driver";
import type { ComputeProvider, ComputeRequest, ComputeResult } from "./types";

// Symbolic computation with sympy, inside an isolated workspace.
//
// The script below is fixed source. The request travels as a JSON file the
// script reads; no part of a request is ever spliced into Python code. sympy's
// parser does evaluate its input internally, which is exactly why this runs in
// a sandbox and never in the web process -- and why every expression has
// already passed the character allow-list in types.ts before it gets here.

const SCRIPT = String.raw`
import json, sys
req = json.load(open(sys.argv[1]))
packages = {}
for name in ("sympy", "numpy", "scipy", "pandas"):
    try:
        __import__(name)
        packages[name] = True
    except Exception:
        packages[name] = False

def emit(obj):
    obj["packages"] = packages
    print(json.dumps(obj, default=str))
    sys.exit(0)

if req["op"] == "probe":
    emit({"ok": True})
if not packages["sympy"]:
    emit({"ok": False, "error": "sympy_not_installed"})

import sympy as sp
from sympy.parsing.sympy_parser import (
    parse_expr, standard_transformations,
    implicit_multiplication_application, convert_xor,
)
T = standard_transformations + (implicit_multiplication_application, convert_xor)

def names(req):
    found = set(req.get("variables", []))
    if req.get("variable"):
        found.add(req["variable"])
    return {n: sp.Symbol(n) for n in found}

def P(text, local):
    return parse_expr(text, local_dict=local, transformations=T, evaluate=True)

def eq(text, local):
    if "=" in text:
        left, right = text.split("=", 1)
        return sp.Eq(P(left, local), P(right, local))
    return sp.Eq(P(text, local), 0)

op = req["op"]
try:
    local = names(req)
    if op == "solve":
        symbols = [local[v] for v in req["variables"]]
        sols = sp.solve([eq(e, local) for e in req["equations"]], symbols, dict=True)
        exact = [{str(k): str(v) for k, v in s.items()} for s in sols]
        numeric = []
        for s in sols:
            row = {}
            for k, v in s.items():
                try:
                    row[str(k)] = complex(sp.N(v))
                    row[str(k)] = row[str(k)].real if abs(row[str(k)].imag) < 1e-12 else str(sp.N(v))
                except Exception:
                    row[str(k)] = str(v)
            numeric.append(row)
        emit({"ok": len(sols) > 0, "value": {"exact": exact, "numeric": numeric},
              "text": "; ".join(", ".join(f"{k} = {v}" for k, v in s.items()) for s in exact) or "no solution",
              "exact": True, "method": "sympy.solve"})
    if op == "simplify":
        r = sp.simplify(P(req["expression"], local))
        emit({"ok": True, "value": str(r), "text": str(r), "exact": True, "method": "sympy.simplify"})
    if op == "derivative":
        r = sp.diff(P(req["expression"], local), local[req["variable"]])
        emit({"ok": True, "value": str(r), "text": str(r), "exact": True, "method": "sympy.diff"})
    if op == "integrate":
        x = local[req["variable"]]
        f = P(req["expression"], local)
        if req.get("lower") is not None and req.get("upper") is not None:
            r = sp.integrate(f, (x, req["lower"], req["upper"]))
            emit({"ok": True, "value": float(sp.N(r)), "text": str(r), "exact": True, "method": "sympy.integrate.definite"})
        r = sp.integrate(f, x)
        emit({"ok": not r.has(sp.Integral), "value": str(r), "text": str(r) + " + C", "exact": True, "method": "sympy.integrate"})
    if op == "evaluate":
        scope = {k: v for k, v in (req.get("scope") or {}).items()}
        r = P(req["expression"], {**local, **{k: sp.Symbol(k) for k in scope}})
        r = r.subs({sp.Symbol(k): v for k, v in scope.items()})
        n = sp.N(r, 30)
        emit({"ok": True, "value": float(n) if n.is_real else str(n), "text": str(n), "exact": False, "method": "sympy.N"})
    if op == "matrix":
        A = sp.Matrix(req["a"])
        o = req["operation"]
        if o == "determinant":
            r = A.det(); emit({"ok": True, "value": float(r), "text": str(r), "exact": True, "method": "sympy.det"})
        if o == "inverse":
            r = A.inv(); emit({"ok": True, "value": [[float(v) for v in row] for row in r.tolist()], "text": str(r), "exact": True, "method": "sympy.inv"})
        if o == "transpose":
            r = A.T; emit({"ok": True, "value": [[float(v) for v in row] for row in r.tolist()], "text": str(r), "exact": True, "method": "sympy.transpose"})
        B = sp.Matrix(req["b"])
        if o == "multiply":
            r = A * B; emit({"ok": True, "value": [[float(v) for v in row] for row in r.tolist()], "text": str(r), "exact": True, "method": "sympy.mul"})
        if o == "solve":
            r = A.LUsolve(B); emit({"ok": True, "value": [[float(v) for v in row] for row in r.tolist()], "text": str(r), "exact": True, "method": "sympy.LUsolve"})
    emit({"ok": False, "error": f"unsupported_op:{op}"})
except SystemExit:
    raise
except Exception as error:
    emit({"ok": False, "error": type(error).__name__ + ": " + str(error)[:300]})
`;

const SUPPORTED = new Set([
  "solve",
  "simplify",
  "derivative",
  "integrate",
  "evaluate",
  "matrix",
]);

export type PythonProbe = {
  available: boolean;
  packages: Record<string, boolean>;
  reason?: string;
};

export class PythonComputeProvider implements ComputeProvider {
  readonly id = "python-sympy";
  private probed: PythonProbe | null = null;
  private written = false;

  constructor(private readonly workspace: () => Promise<SandboxHandle>) {}

  supports(request: ComputeRequest) {
    return SUPPORTED.has(request.op);
  }

  private async run(payload: Record<string, unknown>, signal?: AbortSignal) {
    const handle = await this.workspace();
    if (!this.written) {
      await handle.writeFiles([{ path: "osirus_compute.py", content: SCRIPT }]);
      this.written = true;
    }
    const name = `req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`;
    await handle.writeFiles([{ path: name, content: JSON.stringify(payload) }]);
    const result = await handle.runCommand({
      cmd: "python3",
      args: ["osirus_compute.py", name],
      timeoutMs: 30_000,
      signal,
    });
    const line = result.stdout.trim().split("\n").pop() ?? "";
    try {
      return { parsed: JSON.parse(line) as Record<string, unknown>, result };
    } catch {
      return { parsed: null, result };
    }
  }

  async probe(): Promise<PythonProbe> {
    if (this.probed) return this.probed;
    try {
      const { parsed, result } = await this.run({ op: "probe" });
      this.probed = parsed
        ? {
            available: true,
            packages: (parsed.packages as Record<string, boolean>) ?? {},
          }
        : {
            available: false,
            packages: {},
            reason: result.stderr.slice(0, 300) || "python3_unavailable",
          };
    } catch (error) {
      this.probed = {
        available: false,
        packages: {},
        reason:
          error instanceof Error ? error.message : "workspace_unavailable",
      };
    }
    return this.probed;
  }

  async compute(
    request: ComputeRequest,
    signal?: AbortSignal,
  ): Promise<ComputeResult> {
    const base = { op: request.op, provider: this.id } as const;
    const probe = await this.probe();
    if (!probe.available) {
      return {
        ...base,
        ok: false,
        method: "unavailable",
        error: probe.reason ?? "python_unavailable",
      };
    }
    if (!probe.packages.sympy) {
      return {
        ...base,
        ok: false,
        method: "unavailable",
        error: "sympy_not_installed",
      };
    }
    const { parsed, result } = await this.run(
      request as Record<string, unknown>,
      signal,
    );
    if (!parsed) {
      return {
        ...base,
        ok: false,
        method: "error",
        error: (result.stderr || "no_output").slice(0, 300),
      };
    }
    return {
      ...base,
      ok: parsed.ok === true,
      value: parsed.value,
      text: typeof parsed.text === "string" ? parsed.text : undefined,
      exact: parsed.exact === true,
      method: typeof parsed.method === "string" ? parsed.method : "sympy",
      error: typeof parsed.error === "string" ? parsed.error : undefined,
    };
  }
}
