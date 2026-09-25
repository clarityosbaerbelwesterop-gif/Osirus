import type { ModelProvider, Usage } from "../../models/provider";
import { judge } from "../executors/judge";
import type { TaskSpec } from "../types";

// Raw model vs Osirus (M44–M48).
//
//   A = the free UnoRouter model, one call, the task as the prompt.
//   B = the same model inside Osirus: routing, planning, tools, memory,
//       verification, the agent loop.
//
// Same tasks, same model, same independent judge (the task's own verify:
// a computed number, required content, hidden tests). The gap between A
// and B is what Osirus adds; it is tracked per family over time. A side
// that was cut off by the call budget is excluded, never scored as a fail.

export type Meter = {
  provider: ModelProvider;
  spent(): { calls: number; tokens: number };
  remaining(): number;
  exhausted(): boolean;
};

function refusal() {
  // Shaped like a provider refusal, so the harness ends the step honestly
  // and the trial is excluded rather than counted against a strategy.
  return Object.assign(new Error("rsi order budget spent (rate_limited)"), {
    name: "ProviderError",
    code: "rate_limited",
    retryAfterMs: null,
  });
}

/** Count every call and refuse once the order's reservation is spent. */
export function budgetedProvider(inner: ModelProvider, limit: number): Meter {
  let calls = 0;
  let tokens = 0;
  let exhausted = false;
  const take = () => {
    if (calls >= limit) {
      exhausted = true;
      throw refusal();
    }
    calls += 1;
  };
  const add = (usage: Usage | undefined) => {
    tokens += (usage?.inputTokens ?? 0) + (usage?.outputTokens ?? 0);
  };
  const provider: ModelProvider = {
    ...inner,
    modelId: (role) => inner.modelId(role),
    capabilities: () => inner.capabilities(),
    healthCheck: () => inner.healthCheck(),
    cancel: (id) => inner.cancel(id),
    normalizeUsage: (raw) => inner.normalizeUsage(raw),
    normalizeError: (error) => inner.normalizeError(error),
    async *stream(input) {
      take();
      for await (const event of inner.stream(input)) {
        if (event.type === "usage") add(event.usage);
        yield event;
      }
    },
    async complete(input) {
      take();
      const result = await inner.complete(input);
      add(result.usage);
      return result;
    },
    async structured(input) {
      take();
      const result = await inner.structured(input);
      add(result.usage);
      return result;
    },
  };
  return {
    provider,
    spent: () => ({ calls, tokens }),
    remaining: () => Math.max(0, limit - calls),
    exhausted: () => exhausted,
  };
}

export type SideResult = {
  verified: boolean;
  modelCalls: number;
  tokens: number;
} | null;

export const rawVsOsirusSide = {
  /** A: one call, no Osirus. Null when the task cannot be judged raw. */
  async raw(
    provider: ModelProvider,
    spec: TaskSpec,
    meter?: Meter,
  ): Promise<SideResult> {
    if (spec.verify.kind === "tests") return null;
    const before = meter?.spent() ?? { calls: 0, tokens: 0 };
    try {
      const result = await provider.complete({
        requestId: `raw:${Date.now()}`,
        role: "STRONG",
        messages: [
          {
            role: "system",
            content:
              "Answer the user's question. Think it through, then state the final answer clearly.",
          },
          { role: "user", content: spec.objective },
        ],
      });
      const check = judge(spec.verify, {
        status: "completed",
        answer: result.text,
        verdicts: [],
        hiddenCheck: null,
        notes: [],
      });
      const after = meter?.spent() ?? { calls: 1, tokens: 0 };
      return {
        verified: check.passed,
        modelCalls: after.calls - before.calls,
        tokens: after.tokens - before.tokens,
      };
    } catch {
      // A refusal or budget stop: excluded, not a fail.
      return null;
    }
  },
};

export type BenchmarkRow = {
  family: string;
  raw: SideResult;
  osirus: SideResult;
};

export type FamilyGap = {
  family: string;
  pairs: number;
  raw: {
    verified: number;
    rate: number | null;
    callsPerVerified: number | null;
  };
  osirus: {
    verified: number;
    rate: number | null;
    callsPerVerified: number | null;
  };
  /** Osirus rate minus raw rate over the paired tasks. */
  gap: number | null;
};

/** Per family, over pairs where both sides were judged. */
export function benchmarkGaps(rows: BenchmarkRow[]): FamilyGap[] {
  const families = [...new Set(rows.map((row) => row.family))].sort();
  return families.map((family) => {
    const paired = rows.filter(
      (row) => row.family === family && row.raw && row.osirus,
    );
    const side = (pick: (row: BenchmarkRow) => SideResult) => {
      const verified = paired.filter((row) => pick(row)!.verified).length;
      const calls = paired.reduce((sum, row) => sum + pick(row)!.modelCalls, 0);
      return {
        verified,
        rate: paired.length ? verified / paired.length : null,
        callsPerVerified: verified ? calls / verified : null,
      };
    };
    const raw = side((row) => row.raw);
    const osirus = side((row) => row.osirus);
    return {
      family,
      pairs: paired.length,
      raw,
      osirus,
      gap:
        raw.rate !== null && osirus.rate !== null
          ? Number((osirus.rate - raw.rate).toFixed(3))
          : null,
    };
  });
}
