import { describe, expect, it } from "vitest";
import {
  coreSpec,
  type FoundationAdapter,
  type FoundationCall,
  type FoundationEvent,
} from "../src/lib/rouge/foundation";
import {
  agreementOf,
  answerKey,
  extractFinal,
} from "../src/lib/rouge/kernel/answers";
import { think, type CoreCall } from "../src/lib/rouge/kernel/cognition";
import {
  approachesFor,
  briefing,
  fallbackTaskModel,
  parseTaskModel,
} from "../src/lib/rouge/kernel/task-model";
import { cognitivePolicy, defaultPolicy } from "../src/lib/rouge/policy";
import { RougeRuntime } from "../src/lib/rouge/runtime";
import { MemoryTelemetry } from "../src/lib/rouge/telemetry";
import type { RougeMessage, RougeStreamEvent } from "../src/lib/rouge/types";

// M57: the cognitive kernel -- task model, approach search, agreement as
// uncertainty, adjudication and verification, synthesis.

const CONFIG = {
  candidates: 3,
  adjudicate: true,
  verifyHard: true,
  verifyFrom: 4,
};

type Step =
  | "model"
  | "solve"
  | "adjudicate"
  | "verify"
  | "tiebreak"
  | "synthesis"
  | "direct";

function stepOf(id: string): Step {
  return id.startsWith("solve") ? "solve" : (id as Step);
}

const modelJson = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    kind: "computation",
    goal: "compute the product",
    givens: ["17", "23"],
    constraints: ["an integer"],
    pitfalls: ["carrying"],
    difficulty: 2,
    needsReasoning: true,
    approaches: [
      { name: "long multiplication", how: "multiply digit by digit" },
      { name: "distribute", how: "17*20 + 17*3" },
    ],
    ...over,
  });

/** A fake core: the reply is chosen by the kernel step asking. */
function core(replies: Partial<Record<Step, string | string[] | Error>>) {
  const seen: Array<{
    step: Step;
    id: string;
    system: string;
    messages: RougeMessage[];
    effort: string;
  }> = [];
  const solveCount = { n: 0 };
  const call: CoreCall = async ({ id, system, messages, effort }) => {
    const step = stepOf(id);
    seen.push({ step, id, system, messages, effort });
    const reply = replies[step];
    if (reply instanceof Error) throw reply;
    if (Array.isArray(reply)) return reply[solveCount.n++ % reply.length]!;
    return reply ?? "";
  };
  return { call, seen };
}

const conversation: RougeMessage[] = [
  { role: "user", content: "What is 17 * 23?" },
];

const thinkWith = (
  replies: Parameters<typeof core>[0],
  over: Partial<Parameters<typeof think>[0]> = {},
) => {
  const fake = core(replies);
  const labels: string[] = [];
  return {
    fake,
    labels,
    run: () =>
      think({
        conversation,
        identity: "You are Rouge.",
        contractText: null,
        shortAnswer: false,
        effort: "standard",
        config: CONFIG,
        call: fake.call,
        status: (label) => labels.push(label),
        ...over,
      }),
  };
};

describe("answers and agreement", () => {
  it("reads the committed answer, not the working", () => {
    expect(extractFinal("17*23 = 391\nFINAL ANSWER: 391")).toBe("391");
    expect(extractFinal("Final answer: 12\nwait\nFINAL ANSWER: **13**.")).toBe(
      "13",
    );
    expect(extractFinal("FINAL ANSWER: \\boxed{42}")).toBe("42");
    expect(extractFinal("FINAL ANSWER: Answer: 7")).toBe("7");
    expect(extractFinal("no marker here\n\nthe end is 5")).toBe("the end is 5");
  });

  it("treats formatting as the same answer and different values as different", () => {
    expect(answerKey("1,234")).toBe(answerKey("1234"));
    expect(answerKey("  Paris ")).toBe(answerKey("paris"));
    expect(answerKey("3.50")).toBe(answerKey("3.5"));
    expect(answerKey("391")).not.toBe(answerKey("392"));
  });

  it("measures agreement between approaches", () => {
    const split = agreementOf(["391", "391", "401"]);
    expect(split.unanimous).toBe(false);
    expect(split.top?.answer).toBe("391");
    expect(split.confidence).toBeCloseTo(2 / 3);
    expect(agreementOf(["7", "7", "7"]).unanimous).toBe(true);
    // An empty answer is a dissent, not a vote.
    expect(agreementOf(["7", "7", ""]).unanimous).toBe(false);
  });
});

describe("task model", () => {
  it("parses a model-written task model, fenced or wrapped in prose", () => {
    const model = parseTaskModel(
      `Here it is:\n\`\`\`json\n${modelJson()}\n\`\`\``,
    );
    expect(model).toMatchObject({ kind: "computation", difficulty: 2 });
    expect(model?.approaches).toHaveLength(2);
  });

  it("normalises what models tend to write instead", () => {
    const model = parseTaskModel(
      JSON.stringify({
        kind: "Math",
        goal: "x",
        difficulty: 9,
        needsReasoning: "yes",
        approaches: [{ description: "just do it" }],
      }),
    );
    expect(model).toMatchObject({
      kind: "computation",
      difficulty: 5,
      needsReasoning: true,
    });
    expect(model?.approaches[0]).toEqual({
      name: "approach",
      how: "just do it",
    });
    expect(
      parseTaskModel(
        JSON.stringify({
          kind: "puzzle",
          goal: "g",
          difficulty: 3,
          needsReasoning: true,
        }),
      )?.kind,
    ).toBe("logic");
    expect(parseTaskModel("no json at all")).toBeNull();
  });

  it("pads approaches with distinct general ones", () => {
    const model = parseTaskModel(modelJson())!;
    const three = approachesFor(model, 3);
    expect(three.map((a) => a.name)).toEqual([
      "long multiplication",
      "distribute",
      "careful step-by-step",
    ]);
    expect(approachesFor(fallbackTaskModel("x"), 3)).toHaveLength(3);
    expect(
      new Set(approachesFor(fallbackTaskModel("x"), 3).map((a) => a.name)).size,
    ).toBe(3);
  });

  it("briefs solvers with goal, givens, constraints and pitfalls", () => {
    const text = briefing(parseTaskModel(modelJson())!);
    expect(text).toContain("Goal: compute the product");
    expect(text).toContain("Known pitfalls to avoid: carrying");
  });
});

describe("thinking (M57 kernel)", () => {
  it("answers conversation and writing directly, briefed by the task model", async () => {
    const { run, fake } = thinkWith({
      model: modelJson({
        kind: "writing",
        needsReasoning: false,
        difficulty: 1,
      }),
      direct: "A poem.",
    });
    const thought = await run();
    expect(thought).toMatchObject({
      mode: "direct",
      text: "A poem.",
      calls: 2,
      approaches: 0,
    });
    expect(fake.seen.map((s) => s.step)).toEqual(["model", "direct"]);
    expect(fake.seen[1]!.system).toContain("Goal: compute the product");
  });

  it("searches independent approaches and synthesises a unanimous answer", async () => {
    const { run, fake, labels } = thinkWith({
      model: modelJson(),
      solve: "17*23 = 391\nFINAL ANSWER: 391",
      synthesis: "17 × 23 = **391**.",
    });
    const thought = await run();
    expect(thought).toMatchObject({
      mode: "search",
      finalAnswer: "391",
      text: "17 × 23 = **391**.",
      approaches: 3,
      confidence: 1,
      adjudicated: false,
      verified: false,
      calls: 5,
      answeredBy: "synthesis",
    });
    const solvers = fake.seen.filter((s) => s.step === "solve");
    expect(solvers).toHaveLength(3);
    // Each solver gets a different approach.
    expect(
      new Set(solvers.map((s) => s.system.split("Your approach: ")[1])).size,
    ).toBe(3);
    expect(fake.seen.at(-1)!.system).toContain("Checked answer: 391");
    expect(labels).toEqual([
      "Understanding the task",
      "Exploring 3 approaches",
      "Writing the answer",
    ]);
  });

  it("adjudicates a disagreement on the evidence, not by majority", async () => {
    const { run, fake } = thinkWith({
      model: modelJson(),
      solve: ["FINAL ANSWER: 381", "FINAL ANSWER: 381", "FINAL ANSWER: 391"],
      adjudicate: "Attempts 1 and 2 dropped a carry.\nFINAL ANSWER: 391",
      synthesis: "391",
    });
    const thought = await run();
    expect(thought).toMatchObject({
      finalAnswer: "391",
      adjudicated: true,
      corrected: true,
      calls: 6,
    });
    const adjudication = fake.seen.find((s) => s.step === "adjudicate")!;
    expect(adjudication.effort).toBe("deep");
    const dossier = adjudication.messages.at(-1)!.content;
    expect(dossier).toContain("Attempt 1");
    expect(dossier).toContain("Attempt 3");
    expect(dossier).toContain("What is 17 * 23?");
  });

  it("keeps the leading answer when the adjudicator gives none", async () => {
    const { run } = thinkWith({
      model: modelJson(),
      solve: ["FINAL ANSWER: 381", "FINAL ANSWER: 381", "FINAL ANSWER: 391"],
      adjudicate: new Error("rate limited"),
      synthesis: "381",
    });
    expect(await run()).toMatchObject({
      finalAnswer: "381",
      adjudicated: false,
      confidence: 2 / 3,
    });
  });

  it("verifies a unanimous answer to a hard task by an independent method", async () => {
    const { run, fake } = thinkWith({
      model: modelJson({ difficulty: 4 }),
      solve: "FINAL ANSWER: 391",
      verify: "Check: 391 / 23 = 17.\nFINAL ANSWER: 391",
      synthesis: "391",
    });
    const thought = await run();
    expect(thought).toMatchObject({
      verified: true,
      corrected: false,
      calls: 6,
    });
    expect(fake.seen.map((s) => s.step)).not.toContain("tiebreak");
  });

  it("overturns a unanimous answer only when a fresh solver backs the verifier", async () => {
    const overturned = thinkWith({
      model: modelJson({ difficulty: 5 }),
      solve: "FINAL ANSWER: 381",
      verify: "381 / 23 is not 17.\nFINAL ANSWER: 391",
      tiebreak: "FINAL ANSWER: 391",
      synthesis: "391",
    });
    expect(await overturned.run()).toMatchObject({
      finalAnswer: "391",
      corrected: true,
      calls: 7,
    });

    const upheld = thinkWith({
      model: modelJson({ difficulty: 5 }),
      solve: "FINAL ANSWER: 391",
      verify: "FINAL ANSWER: 400",
      tiebreak: "FINAL ANSWER: 391",
      synthesis: "391",
    });
    expect(await upheld.run()).toMatchObject({
      finalAnswer: "391",
      corrected: false,
    });
  });

  it("returns the checked answer itself when the person asked for only that", async () => {
    const { run, fake } = thinkWith(
      { model: modelJson(), solve: "FINAL ANSWER: 391" },
      { shortAnswer: true, contractText: "Reply with the number only." },
    );
    const thought = await run();
    expect(thought.text).toBe("391");
    expect(fake.seen.map((s) => s.step)).not.toContain("synthesis");
    expect(fake.seen.find((s) => s.step === "solve")!.system).toContain(
      "Required answer format: Reply with the number only.",
    );
  });

  it("surfaces the provider's refusal when no approach can answer", async () => {
    const refusal = Object.assign(new Error("no credit"), {
      code: "insufficient_credit",
    });
    const { run } = thinkWith({ model: modelJson(), solve: refusal });
    await expect(run()).rejects.toMatchObject({ code: "insufficient_credit" });
  });

  it("falls back to one direct answer when the task model is unusable", async () => {
    const { run, fake } = thinkWith({
      model: "I cannot do JSON",
      direct: "391",
    });
    expect(await run()).toMatchObject({ mode: "direct", text: "391" });
    expect(fake.seen.map((s) => s.step)).toEqual(["model", "direct"]);
  });

  it("thinks harder on request: deep solvers, ultra checks", async () => {
    const { run, fake } = thinkWith(
      {
        model: modelJson(),
        solve: ["FINAL ANSWER: 1", "FINAL ANSWER: 2", "FINAL ANSWER: 1"],
        adjudicate: "FINAL ANSWER: 1",
        synthesis: "1",
      },
      { effort: "ultra" },
    );
    await run();
    expect(fake.seen.find((s) => s.step === "solve")!.effort).toBe("ultra");
    expect(fake.seen.find((s) => s.step === "adjudicate")!.effort).toBe(
      "ultra",
    );
    expect(fake.seen.find((s) => s.step === "model")!.effort).toBe("quick");
  });
});

class Kernel implements FoundationAdapter {
  readonly core = coreSpec("grok-4.6");
  readonly calls: FoundationCall[] = [];
  constructor(
    private readonly reply: (call: FoundationCall) => string,
    private readonly servedBy: (requestId: string) => string = () => "grok-4.6",
  ) {}
  servedModel(requestId: string) {
    return this.calls.some((c) => c.requestId === requestId)
      ? this.servedBy(requestId)
      : undefined;
  }
  async *stream(call: FoundationCall): AsyncIterable<FoundationEvent> {
    this.calls.push(call);
    yield { type: "delta", text: this.reply(call) };
    yield {
      type: "usage",
      usage: { inputTokens: 100, outputTokens: 20, cost: null },
    };
  }
}

const byStep = (call: FoundationCall) => {
  if (call.system.includes("You analyse a task")) return modelJson();
  if (call.system.includes("independent solvers"))
    return "working\nFINAL ANSWER: 391";
  if (call.system.includes("Write the final response")) return "17 × 23 = 391.";
  return "Hallo! Wie kann ich helfen?";
};

describe("Rouge p2 at run time", () => {
  it("is the default policy", () => {
    expect(defaultPolicy("grok-4.6")).toEqual(cognitivePolicy("grok-4.6"));
    expect(cognitivePolicy().version).toBe("p2");
  });

  it("deliberates on a reasoning task, streaming activity and then one answer", async () => {
    const foundation = new Kernel(byStep);
    const telemetry = new MemoryTelemetry();
    const rouge = new RougeRuntime({
      foundation,
      policy: cognitivePolicy("grok-4.6"),
      telemetry,
    });
    const events: RougeStreamEvent[] = [];
    for await (const event of rouge.stream({
      requestId: "r1",
      messages: [
        { role: "user", content: "What is 17 * 23? Show the working." },
      ],
    }))
      events.push(event);
    expect(
      events
        .filter((e) => e.type === "status")
        .map((e) => (e as { label: string }).label),
    ).toEqual([
      "Understanding the task",
      "Exploring 3 approaches",
      "Writing the answer",
    ]);
    const deltas = events.filter((e) => e.type === "delta");
    expect(deltas).toEqual([{ type: "delta", text: "17 × 23 = 391." }]);
    const done = events.at(-1);
    if (done?.type !== "done") throw new Error("no answer");
    expect(done.response.kernel?.cognition).toMatchObject({
      mode: "search",
      approaches: 3,
      confidence: 1,
      calls: 5,
    });
    expect(done.response.usage).toMatchObject({
      inputTokens: 500,
      outputTokens: 100,
    });
    expect(done.response.core).toEqual({
      requested: "grok-4.6",
      served: "grok-4.6",
      substituted: false,
    });
    // Every step is its own call, correlated to the request.
    const ids = foundation.calls.map((c) => c.requestId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => id.startsWith("r1:"))).toBe(true);
    // Telemetry: what the kernel did, never what was said.
    const record = telemetry.records[0]!;
    expect(record.cognition).toMatchObject({
      mode: "search",
      taskKind: "computation",
      difficulty: 2,
    });
    expect(JSON.stringify(record)).not.toContain("391");
    expect(JSON.stringify(record)).not.toContain("17 * 23");
  });

  it("answers small talk and quick requests in one call", async () => {
    for (const request of [
      { content: "Hallo", effort: undefined },
      { content: "What is 17 * 23?", effort: "quick" as const },
    ]) {
      const foundation = new Kernel(byStep);
      const rouge = new RougeRuntime({
        foundation,
        policy: cognitivePolicy("grok-4.6"),
      });
      const response = await rouge.respond({
        requestId: "r2",
        messages: [{ role: "user", content: request.content }],
        effort: request.effort,
      });
      expect(foundation.calls).toHaveLength(1);
      expect(response.kernel?.cognition).toBeUndefined();
    }
  });

  it("holds a short answer to its contract without a synthesis call", async () => {
    const foundation = new Kernel(byStep);
    const rouge = new RougeRuntime({
      foundation,
      policy: cognitivePolicy("grok-4.6"),
    });
    const response = await rouge.respond({
      requestId: "r3",
      messages: [
        {
          role: "user",
          content: "What is 17 * 23? Reply with the number only.",
        },
      ],
    });
    expect(response.text).toBe("391");
    expect(response.kernel).toMatchObject({
      contract: "number",
      contractMet: true,
      repairs: 0,
    });
    expect(
      foundation.calls.some((c) =>
        c.system.includes("Write the final response"),
      ),
    ).toBe(false);
  });

  it("labels the answer substituted when any step was served by another model", async () => {
    const foundation = new Kernel(byStep, (id) =>
      id.endsWith(":solve-2") ? "nemotron-3-ultra-550b-a55b:free" : "grok-4.6",
    );
    const rouge = new RougeRuntime({
      foundation,
      policy: cognitivePolicy("grok-4.6"),
    });
    const response = await rouge.respond({
      requestId: "r4",
      messages: [{ role: "user", content: "What is 17 * 23?" }],
    });
    expect(response.core.substituted).toBe(true);
  });
});
