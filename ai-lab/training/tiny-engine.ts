/**
 * Tiny CPU fixture: a real linear map y = Wx + b, MSE, one SGD step.
 * This is not Rouge, Quesnir, or Darus. It does not set a trained flag.
 */

export interface TinyState {
  readonly in: number;
  readonly out: number;
  readonly w: readonly number[];
  readonly b: readonly number[];
  readonly lr: number;
  readonly step: number;
}

export interface TinyGrad {
  readonly loss: number;
  readonly gw: number[];
  readonly gb: number[];
}

export function initTiny(input: {
  in: number;
  out: number;
  lr: number;
  seed: number;
}): TinyState {
  const w: number[] = [];
  let state = input.seed >>> 0;
  const next = () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x1_0000_0000 - 0.5;
  };
  for (let i = 0; i < input.in * input.out; i += 1) w.push(next() * 0.1);
  return {
    in: input.in,
    out: input.out,
    w,
    b: Array.from({ length: input.out }, () => 0),
    lr: input.lr,
    step: 0,
  };
}

export function forward(state: TinyState, x: readonly number[]): number[] {
  if (x.length !== state.in)
    throw new Error("feature width does not match the fixture");
  const y: number[] = [];
  for (let o = 0; o < state.out; o += 1) {
    let sum = state.b[o] ?? 0;
    for (let i = 0; i < state.in; i += 1) {
      sum += (state.w[o * state.in + i] ?? 0) * (x[i] ?? 0);
    }
    y.push(sum);
  }
  return y;
}

/** Mean squared error and analytic gradients. Not a self-assigned score. */
export function backward(
  state: TinyState,
  x: readonly number[],
  target: readonly number[],
): TinyGrad {
  if (target.length !== state.out)
    throw new Error("target width does not match the fixture");
  const y = forward(state, x);
  const gw = Array.from({ length: state.w.length }, () => 0);
  const gb = Array.from({ length: state.out }, () => 0);
  let loss = 0;
  for (let o = 0; o < state.out; o += 1) {
    const diff = (y[o] ?? 0) - (target[o] ?? 0);
    loss += diff * diff;
    const grad = (2 / state.out) * diff;
    gb[o] = grad;
    for (let i = 0; i < state.in; i += 1)
      gw[o * state.in + i] = grad * (x[i] ?? 0);
  }
  return { loss: loss / state.out, gw, gb };
}

export function sgdStep(state: TinyState, grad: TinyGrad): TinyState {
  return {
    ...state,
    w: state.w.map((value, index) => value - state.lr * (grad.gw[index] ?? 0)),
    b: state.b.map((value, index) => value - state.lr * (grad.gb[index] ?? 0)),
    step: state.step + 1,
  };
}

export interface TinyExample {
  readonly x: readonly number[];
  readonly y: readonly number[];
}

export function trainStep(
  state: TinyState,
  batch: readonly TinyExample[],
): { state: TinyState; loss: number } {
  if (batch.length === 0)
    throw new Error("tiny fixture refuses an empty batch");
  let gw = Array.from({ length: state.w.length }, () => 0);
  let gb = Array.from({ length: state.out }, () => 0);
  let loss = 0;
  for (const example of batch) {
    const grad = backward(state, example.x, example.y);
    loss += grad.loss;
    gw = gw.map((value, index) => value + (grad.gw[index] ?? 0));
    gb = gb.map((value, index) => value + (grad.gb[index] ?? 0));
  }
  const scale = batch.length;
  const mean: TinyGrad = {
    loss: loss / scale,
    gw: gw.map((value) => value / scale),
    gb: gb.map((value) => value / scale),
  };
  return { state: sgdStep(state, mean), loss: mean.loss };
}
