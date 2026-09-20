export async function spawn<T>(worker: () => Promise<T>) {
  return worker();
}
export async function parallel<T>(workers: Array<() => Promise<T>>) {
  return Promise.all(workers.map((w) => w()));
}
export async function pipeline<T>(seed: T, steps: Array<(v: T) => Promise<T>>) {
  let value = seed;
  for (const step of steps) value = await step(value);
  return value;
}
export async function phase<T>(name: string, fn: () => Promise<T>) {
  const started = Date.now();
  try {
    return await fn();
  } finally {
    void name;
    void started;
  }
}
export function log(type: string, data: Record<string, unknown> = {}) {
  return { type, data, at: new Date().toISOString() };
}
export async function verify<T>(
  value: T,
  checks: Array<(v: T) => Promise<boolean>>,
) {
  for (const check of checks)
    if (!(await check(value))) throw new Error("verification_failed");
  return value;
}
export async function repair<T>(
  attempt: () => Promise<T>,
  verifyFn: (v: T) => Promise<boolean>,
  max = 2,
) {
  let last: T | undefined;
  for (let i = 0; i <= max; i++) {
    last = await attempt();
    if (await verifyFn(last)) return last;
  }
  throw new Error("repair_exhausted");
}
export function checkpoint<T extends Record<string, unknown>>(state: T) {
  return structuredClone(state);
}
