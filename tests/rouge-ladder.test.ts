import { describe, expect, it } from "vitest";
import { CORE_TASKS } from "../evals/rouge/core-selection-tasks";
import {
  coreSpec,
  type CoreSpec,
  type FoundationAdapter,
  type FoundationCall,
  type FoundationEvent,
} from "../src/lib/rouge/foundation";
import { LadderFoundation } from "../src/lib/rouge/foundations/ladder";
import { defaultPolicy } from "../src/lib/rouge/policy";
import { RougeRuntime } from "../src/lib/rouge/runtime";
import { MemoryTelemetry } from "../src/lib/rouge/telemetry";

// M56.1: when Grok 4.6 cannot answer, Rouge answers from a measured
// substitute core -- labelled as such -- and evaluations never leave the
// named core.

function refusal(code: string) {
  return Object.assign(new Error(code), {
    name: "ProviderError",
    code,
    retryAfterMs: null,
  });
}

class Rung implements FoundationAdapter {
  calls = 0;
  readonly core: CoreSpec;
  constructor(
    id: string,
    private readonly behaviour: { refuse?: string; failMidway?: boolean } = {},
  ) {
    this.core = coreSpec(id);
  }
  servedModel() {
    return this.core.id;
  }
  async *stream(call: FoundationCall): AsyncIterable<FoundationEvent> {
    this.calls += 1;
    expect(call.allowSubstitute).toBe(false);
    if (this.behaviour.refuse) throw refusal(this.behaviour.refuse);
    yield { type: "delta", text: `from ${this.core.id}` };
    if (this.behaviour.failMidway) throw refusal("provider_unavailable");
    yield {
      type: "usage",
      usage: { inputTokens: 1, outputTokens: 1, cost: null },
    };
  }
}

const ask = {
  requestId: "q",
  messages: [{ role: "user" as const, content: "Hallo" }],
};

describe("core ladder (M56.1)", () => {
  it("answers from the first substitute when the core has no credit, and says so", async () => {
    const grok = new Rung("grok-4.6", { refuse: "insufficient_credit" });
    const free = new Rung("nemotron-3-ultra-550b-a55b:free");
    const telemetry = new MemoryTelemetry();
    const rouge = new RougeRuntime({
      foundation: new LadderFoundation([grok, free]),
      policy: defaultPolicy("grok-4.6"),
      telemetry,
    });
    const response = await rouge.respond(ask);
    expect(response.text).toBe("from nemotron-3-ultra-550b-a55b:free");
    expect(response.core).toEqual({
      requested: "grok-4.6",
      served: "nemotron-3-ultra-550b-a55b:free",
      substituted: true,
    });
    expect(telemetry.records[0]).toMatchObject({ substituted: true });
  });

  it("stops asking a core without credit for a while", async () => {
    let clock = 0;
    const grok = new Rung("grok-4.6", { refuse: "insufficient_credit" });
    const free = new Rung("kimi-k3:free");
    const ladder = new LadderFoundation([grok, free], () => clock);
    const rouge = new RougeRuntime({
      foundation: ladder,
      policy: defaultPolicy("grok-4.6"),
    });
    await rouge.respond({ ...ask, requestId: "a" });
    await rouge.respond({ ...ask, requestId: "b" });
    expect(grok.calls).toBe(1);
    clock += 11 * 60_000; // credit may have been added: ask again
    await rouge.respond({ ...ask, requestId: "c" });
    expect(grok.calls).toBe(2);
    expect(free.calls).toBe(3);
  });

  it("never substitutes in an evaluation", async () => {
    const grok = new Rung("grok-4.6", { refuse: "insufficient_credit" });
    const free = new Rung("kimi-k3:free");
    const rouge = new RougeRuntime({
      foundation: new LadderFoundation([grok, free]),
      policy: defaultPolicy("grok-4.6"),
      allowCoreSubstitute: false,
    });
    await expect(rouge.respond(ask)).rejects.toMatchObject({
      code: "insufficient_credit",
    });
    expect(free.calls).toBe(0);
  });

  it("does not swap cores in the middle of an answer", async () => {
    const first = new Rung("grok-4.6", { failMidway: true });
    const second = new Rung("kimi-k3:free");
    const rouge = new RougeRuntime({
      foundation: new LadderFoundation([first, second]),
      policy: defaultPolicy("grok-4.6"),
    });
    await expect(rouge.respond(ask)).rejects.toMatchObject({
      code: "provider_unavailable",
    });
    expect(second.calls).toBe(0);
  });

  it("reports the last refusal when every core refuses", async () => {
    const rouge = new RougeRuntime({
      foundation: new LadderFoundation([
        new Rung("grok-4.6", { refuse: "insufficient_credit" }),
        new Rung("kimi-k3:free", { refuse: "rate_limited" }),
      ]),
      policy: defaultPolicy("grok-4.6"),
    });
    await expect(rouge.respond(ask)).rejects.toMatchObject({
      code: "rate_limited",
    });
  });

  it("does not skip past a non-provider failure", async () => {
    const broken = new Rung("grok-4.6");
    broken.stream = async function* () {
      throw new Error("bug");
    };
    const free = new Rung("kimi-k3:free");
    const rouge = new RougeRuntime({
      foundation: new LadderFoundation([broken, free]),
      policy: defaultPolicy("grok-4.6"),
    });
    await expect(rouge.respond(ask)).rejects.toThrow("bug");
    expect(free.calls).toBe(0);
  });
});

describe("core selection tasks (teacher-written)", () => {
  // Each task's checker must accept its right answer and reject a close
  // wrong one; otherwise the tournament would measure the checker.
  const right: Record<string, string> = {
    "arith-1": "1651",
    "arith-2": "6",
    algebra: "-12",
    "time-1": "205",
    "date-1": "Saturday",
    "units-1": "2750",
    "units-2": "210",
    "logic-1": "Dana",
    "logic-2": "Mixed",
    "logic-3": "5",
    "code-1": "2-4-6",
    "code-2": "4",
    "code-3": "false",
    "prob-1": "1/6",
    "seq-1": "42",
    "de-1": "1440",
    "de-2": "Samstag",
    "count-1": "3",
    "instr-1": "red yellow blue",
    "instr-2": '{"city": "Tokyo", "country": "Japan"}',
    "facts-1": "W",
  };
  const wrong: Record<string, string> = {
    "arith-1": "1776",
    "arith-2": "1267",
    algebra: "12",
    "time-1": "325",
    "date-1": "Friday",
    "units-1": "275",
    "units-2": "180",
    "logic-1": "Carol",
    "logic-2": "Apples",
    "logic-3": "100",
    "code-1": "6-2-4",
    "code-2": "11",
    "code-3": "true",
    "prob-1": "1/12",
    "seq-1": "40",
    "de-1": "1400",
    "de-2": "Freitag",
    "count-1": "2",
    "instr-1": "Red, Yellow and Blue are the primary colours.",
    "instr-2": '{"city": "Kyoto", "country": "Japan"}',
    "facts-1": "Tu",
  };

  it("covers every task", () => {
    expect(Object.keys(right).sort()).toEqual(
      CORE_TASKS.map((task) => task.id).sort(),
    );
    expect(
      new Set(CORE_TASKS.map((task) => task.family)).size,
    ).toBeGreaterThanOrEqual(8);
  });

  for (const task of CORE_TASKS) {
    it(`${task.id} accepts the answer and rejects a wrong one`, () => {
      expect(task.correct(right[task.id]!)).toBe(true);
      expect(task.strict(right[task.id]!)).toBe(true);
      expect(task.correct(wrong[task.id]!)).toBe(false);
      expect(task.strict(wrong[task.id]!)).toBe(false);
    });
  }

  it("counts a right answer in the wrong shape as wrong only where shape is the task", () => {
    const json = CORE_TASKS.find((t) => t.id === "instr-2")!;
    expect(
      json.correct('```json\n{"city": "Tokyo", "country": "Japan"}\n```'),
    ).toBe(true);
    expect(json.correct('Sure! {"city": "Tokyo", "country": "Japan"}')).toBe(
      false,
    );
  });

  it("accepts a right answer wrapped in words, but not as strict", () => {
    const task = CORE_TASKS.find((t) => t.id === "arith-1")!;
    expect(task.correct("The result is 1,651.")).toBe(true);
    expect(task.strict("The result is 1,651.")).toBe(false);
    expect(task.strict("1651.")).toBe(true);
  });
});
