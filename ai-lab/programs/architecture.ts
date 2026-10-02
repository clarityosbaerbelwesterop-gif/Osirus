/**
 * Tiny real decoder pieces. These run on CPU fixtures.
 * They are not a trained Rouge, Quasnir, or Darus checkpoint.
 */

export type ArchFamily = "dense-rope" | "fim-causal" | "routed-dense";

export interface FixtureArch {
  readonly family: ArchFamily;
  readonly vocab: number;
  readonly dim: number;
  readonly heads: number;
  readonly kvHeads: number;
  readonly ffn: number;
  readonly experts: number;
  readonly context: number;
  readonly precision: "fp64-fixture";
}

export interface FixtureParams {
  readonly arch: FixtureArch;
  /** Row-major embedding [vocab, dim]. */
  embed: number[];
  /** Output head [vocab, dim]. */
  head: number[];
  /** Query projection [dim, dim]. */
  wq: number[];
  wk: number[];
  wv: number[];
  /** Expert FFNs. Dense families use experts[0] only. */
  experts: { w1: number[]; w2: number[] }[];
  /** Router [experts, dim] for routed-dense. Empty otherwise. */
  router: number[];
}

export function zeros(n: number): number[] {
  return Array.from({ length: n }, () => 0);
}

export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

export function initParams(arch: FixtureArch, seed: number): FixtureParams {
  const rand = mulberry32(seed);
  const fill = (n: number, scale: number) =>
    Array.from({ length: n }, () => (rand() - 0.5) * scale);
  const experts = Array.from({ length: arch.experts }, () => ({
    w1: fill(arch.ffn * arch.dim, 0.1),
    w2: fill(arch.dim * arch.ffn, 0.1),
  }));
  return {
    arch,
    embed: fill(arch.vocab * arch.dim, 0.1),
    head: fill(arch.vocab * arch.dim, 0.1),
    wq: fill(arch.dim * arch.dim, 0.1),
    wk: fill(arch.dim * arch.dim, 0.1),
    wv: fill(arch.dim * arch.dim, 0.1),
    experts,
    router:
      arch.family === "routed-dense" ? fill(arch.experts * arch.dim, 0.1) : [],
  };
}

export function rmsNorm(x: readonly number[], eps = 1e-5): number[] {
  let ms = 0;
  for (const value of x) ms += value * value;
  const inv = 1 / Math.sqrt(ms / x.length + eps);
  return x.map((value) => value * inv);
}

/** Rotate pairs. This is the fixture positional encoding, not a full RoPE library. */
export function rope(x: readonly number[], position: number): number[] {
  const y = x.slice();
  for (let i = 0; i + 1 < y.length; i += 2) {
    const theta = position / 10000 ** (i / y.length);
    const c = Math.cos(theta);
    const s = Math.sin(theta);
    const a = y[i] ?? 0;
    const b = y[i + 1] ?? 0;
    y[i] = a * c - b * s;
    y[i + 1] = a * s + b * c;
  }
  return y;
}

export function matvec(
  matrix: readonly number[],
  rows: number,
  cols: number,
  vector: readonly number[],
): number[] {
  if (vector.length !== cols) throw new Error("matvec width mismatch");
  const out = zeros(rows);
  for (let r = 0; r < rows; r += 1) {
    let sum = 0;
    for (let c = 0; c < cols; c += 1)
      sum += (matrix[r * cols + c] ?? 0) * (vector[c] ?? 0);
    out[r] = sum;
  }
  return out;
}

export function softmax(values: readonly number[]): number[] {
  const max = Math.max(...values);
  const exps = values.map((value) => Math.exp(value - max));
  const sum = exps.reduce((total, value) => total + value, 0);
  return exps.map((value) => value / sum);
}

export function causalAttention(
  queries: readonly number[][],
  keys: readonly number[][],
  values: readonly number[][],
): number[][] {
  const scale = Math.sqrt(queries[0]?.length || 1);
  return queries.map((query, t) => {
    const scores = keys.slice(0, t + 1).map((key) => {
      let dot = 0;
      for (let i = 0; i < query.length; i += 1)
        dot += (query[i] ?? 0) * (key[i] ?? 0);
      return dot / scale;
    });
    const weights = softmax(scores);
    const mixed = zeros(values[0]?.length ?? 0);
    weights.forEach((weight, index) => {
      const value = values[index] ?? [];
      for (let i = 0; i < mixed.length; i += 1)
        mixed[i] = (mixed[i] ?? 0) + weight * (value[i] ?? 0);
    });
    return mixed;
  });
}

function ffn(
  x: readonly number[],
  w1: readonly number[],
  w2: readonly number[],
  hidden: number,
  dim: number,
): number[] {
  const hiddenOut = matvec(w1, hidden, dim, x).map((value) =>
    Math.max(0, value),
  );
  return matvec(w2, dim, hidden, hiddenOut);
}

export interface ForwardResult {
  readonly logits: number[][];
  readonly route: number[][];
}

/**
 * One decoder step over token ids.
 * dense-rope: RoPE on Q/K.
 * fim-causal: same block, positions tagged so a middle span can attend to a suffix (FIM).
 * routed-dense: softmax over tiny experts, both computed, weighted sum.
 */
export function forwardTokens(
  params: FixtureParams,
  tokens: readonly number[],
  options?: { fimMiddleFrom?: number },
): ForwardResult {
  const { arch } = params;
  if (tokens.length > arch.context)
    throw new Error("sequence exceeds fixture context");
  const hidden: number[][] = tokens.map((token) => {
    if (token < 0 || token >= arch.vocab) throw new Error("token out of vocab");
    const row = params.embed.slice(token * arch.dim, (token + 1) * arch.dim);
    return rmsNorm(row);
  });
  const queries = hidden.map((row, position) => {
    const q = matvec(params.wq, arch.dim, arch.dim, row);
    return arch.family === "dense-rope" ? rope(q, position) : q;
  });
  const keys = hidden.map((row, position) => {
    const k = matvec(params.wk, arch.dim, arch.dim, row);
    return arch.family === "dense-rope" ? rope(k, position) : k;
  });
  const values = hidden.map((row) =>
    matvec(params.wv, arch.dim, arch.dim, row),
  );
  let attended = causalAttention(queries, keys, values);
  if (arch.family === "fim-causal" && options?.fimMiddleFrom !== undefined) {
    const cut = options.fimMiddleFrom;
    attended = attended.map((row, position) => {
      if (position < cut) return row;
      // Middle tokens also mix the last context token (the suffix anchor).
      const anchor = values[values.length - 1] ?? row;
      return row.map(
        (value, index) => 0.5 * value + 0.5 * (anchor[index] ?? 0),
      );
    });
  }
  const routes: number[][] = [];
  const mixed = attended.map((row) => {
    if (arch.family !== "routed-dense") {
      routes.push([1]);
      const expert = params.experts[0];
      if (!expert) throw new Error("missing expert");
      return ffn(rmsNorm(row), expert.w1, expert.w2, arch.ffn, arch.dim);
    }
    const gates = softmax(matvec(params.router, arch.experts, arch.dim, row));
    routes.push(gates);
    const acc = zeros(arch.dim);
    gates.forEach((gate, index) => {
      const expert = params.experts[index];
      if (!expert) return;
      const y = ffn(rmsNorm(row), expert.w1, expert.w2, arch.ffn, arch.dim);
      for (let i = 0; i < acc.length; i += 1)
        acc[i] = (acc[i] ?? 0) + gate * (y[i] ?? 0);
    });
    return acc;
  });
  const logits = mixed.map((row) =>
    matvec(params.head, arch.vocab, arch.dim, rmsNorm(row)),
  );
  return { logits, route: routes };
}

export function meanNll(
  logits: readonly number[][],
  targets: readonly number[],
): number {
  if (logits.length !== targets.length)
    throw new Error("target length mismatch");
  let total = 0;
  for (let t = 0; t < logits.length; t += 1) {
    const probs = softmax(logits[t] ?? []);
    const p = probs[targets[t] ?? 0] ?? 1e-12;
    total += -Math.log(Math.max(p, 1e-12));
  }
  return total / logits.length;
}

/** Analytic gradient of mean NLL w.r.t. the output head, stop-grad on the hidden state. */
export function outputHeadGrad(
  params: FixtureParams,
  hidden: readonly number[],
  target: number,
): number[] {
  const logits = matvec(
    params.head,
    params.arch.vocab,
    params.arch.dim,
    hidden,
  );
  const probs = softmax(logits);
  const grad = zeros(params.head.length);
  for (let v = 0; v < params.arch.vocab; v += 1) {
    const delta = (probs[v] ?? 0) - (v === target ? 1 : 0);
    for (let d = 0; d < params.arch.dim; d += 1) {
      grad[v * params.arch.dim + d] = delta * (hidden[d] ?? 0);
    }
  }
  return grad;
}

export function cloneParams(params: FixtureParams): FixtureParams {
  return {
    arch: params.arch,
    embed: params.embed.slice(),
    head: params.head.slice(),
    wq: params.wq.slice(),
    wk: params.wk.slice(),
    wv: params.wv.slice(),
    experts: params.experts.map((expert) => ({
      w1: expert.w1.slice(),
      w2: expert.w2.slice(),
    })),
    router: params.router.slice(),
  };
}

export function applyHeadGrad(
  params: FixtureParams,
  grad: readonly number[],
  lr: number,
): FixtureParams {
  const next = cloneParams(params);
  next.head = next.head.map((value, index) => value - lr * (grad[index] ?? 0));
  return next;
}
