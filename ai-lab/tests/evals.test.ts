/**
 * AI Lab — eval runner tests (Phase J).
 *
 * The runner is exercised exclusively against a FakeBackend: no real model
 * calls, no network, no GPU. Covers seed enforcement, full EvalRecord shape,
 * deterministic graders, config hashing, and the gated model-as-judge path.
 */

import { describe, expect, it } from "vitest";

import type {
  GenerateRequest,
  GenerateResult,
  ModelBackend,
} from "../contracts/model-backend";
import {
  configHash,
  gradeDeterministic,
  parseTaskFixture,
  runEvals,
  validateTaskFixture,
  type EvalTaskSpec,
} from "../evals/runner";

/** Deterministic in-memory backend; echoes a canned answer per prompt. */
class FakeBackend implements ModelBackend {
  readonly kind = "local_inference" as const;
  readonly modelId = "fake/fake-0b";
  readonly selfTrained = false;
  readonly requests: GenerateRequest[] = [];

  constructor(private readonly answers: Record<string, string>) {}

  generate(req: GenerateRequest): Promise<GenerateResult> {
    this.requests.push(req);
    const text = this.answers[req.prompt] ?? "";
    return Promise.resolve({
      text,
      usage: { inputTokens: req.prompt.length, outputTokens: text.length },
      latencyMs: 7,
      backendVersion: "fake/0.0.1",
    });
  }
}

const tasks: EvalTaskSpec[] = [
  {
    taskId: "t/exact",
    prompt: "2+2?",
    grader: { kind: "exact_match", expected: "4" },
  },
  {
    taskId: "t/contains",
    prompt: "name a color",
    grader: { kind: "contains", expected: "blue" },
  },
  {
    taskId: "t/regex",
    prompt: "version?",
    grader: { kind: "regex", expected: "v\\d+\\.\\d+" },
  },
];

const backend = () =>
  new FakeBackend({
    "2+2?": "4",
    "name a color": "the ocean is blue",
    "version?": "release v1.2 ready",
  });

describe("runEvals", () => {
  it("produces a complete EvalRecord per task", async () => {
    const records = await runEvals({
      backend: backend(),
      tasks,
      seed: 42,
      config: { suite: "smoke", temperature: 0 },
      now: () => new Date("2026-10-02T00:00:00.000Z"),
    });
    expect(records).toHaveLength(3);
    for (const record of records) {
      expect(record).toMatchObject({
        modelId: "fake/fake-0b",
        backendKind: "local_inference",
        seed: 42,
        latencyMs: 7,
        createdAt: "2026-10-02T00:00:00.000Z",
        modelJudged: false,
      });
      expect(record.configHash).toMatch(/^[0-9a-f]{8}$/);
      expect(typeof record.pass).toBe("boolean");
      expect(record.taskId).toMatch(/^t\//);
    }
  });

  it("grades deterministically: exact_match, contains, regex", async () => {
    const records = await runEvals({ backend: backend(), tasks, seed: 1 });
    expect(records.map((r) => [r.taskId, r.pass])).toEqual([
      ["t/exact", true],
      ["t/contains", true],
      ["t/regex", true],
    ]);
  });

  it("records failures honestly instead of hiding them", async () => {
    const records = await runEvals({
      backend: new FakeBackend({ "2+2?": "5" }),
      tasks: [tasks[0]],
      seed: 1,
    });
    expect(records[0].pass).toBe(false);
  });

  it("forwards the mandatory seed to every generation request", async () => {
    const fake = backend();
    await runEvals({ backend: fake, tasks, seed: 1234 });
    expect(fake.requests.map((r) => r.seed)).toEqual([1234, 1234, 1234]);
    expect(fake.requests.every((r) => r.temperature === 0)).toBe(true);
  });

  it("rejects a missing or non-integer seed", async () => {
    await expect(
      runEvals({ backend: backend(), tasks, seed: Number.NaN }),
    ).rejects.toThrow(/seed/);
    await expect(
      runEvals({ backend: backend(), tasks, seed: 1.5 }),
    ).rejects.toThrow(/seed/);
    await expect(
      runEvals({
        backend: backend(),
        tasks,
        seed: undefined as unknown as number,
      }),
    ).rejects.toThrow(/seed/);
  });

  it("configHash is stable for equal configs and changes with the config", async () => {
    const a = await runEvals({
      backend: backend(),
      tasks,
      seed: 1,
      config: { b: 2, a: 1 },
    });
    const b = await runEvals({
      backend: backend(),
      tasks,
      seed: 1,
      config: { a: 1, b: 2 },
    });
    const c = await runEvals({
      backend: backend(),
      tasks,
      seed: 1,
      config: { a: 1, b: 3 },
    });
    expect(a[0].configHash).toBe(b[0].configHash);
    expect(a[0].configHash).not.toBe(c[0].configHash);
    expect(configHash({})).toMatch(/^[0-9a-f]{8}$/);
  });

  it("refuses model-as-judge tasks unless explicitly enabled", async () => {
    const judged: EvalTaskSpec[] = [
      { taskId: "t/judged", prompt: "essay?", grader: { kind: "model_judge" } },
    ];
    await expect(
      runEvals({ backend: backend(), tasks: judged, seed: 1 }),
    ).rejects.toThrow(/model-as-judge/);
  });

  it("flags model-judged records when the escape hatch is enabled", async () => {
    const judged: EvalTaskSpec[] = [
      { taskId: "t/judged", prompt: "essay?", grader: { kind: "model_judge" } },
    ];
    const records = await runEvals({
      backend: backend(),
      tasks: judged,
      seed: 1,
      allowModelJudge: true,
      judge: () => Promise.resolve(true),
    });
    expect(records[0]).toMatchObject({
      pass: true,
      modelJudged: true,
      graderKind: "model_judge",
    });
  });

  it("requires a judge function even when model-as-judge is allowed", async () => {
    const judged: EvalTaskSpec[] = [
      { taskId: "t/judged", prompt: "essay?", grader: { kind: "model_judge" } },
    ];
    await expect(
      runEvals({
        backend: backend(),
        tasks: judged,
        seed: 1,
        allowModelJudge: true,
      }),
    ).rejects.toThrow(/model-as-judge/);
  });
});

describe("gradeDeterministic", () => {
  it("trims whitespace for exact_match", () => {
    expect(
      gradeDeterministic({ kind: "exact_match", expected: " 4 " }, "4\n"),
    ).toBe(true);
  });

  it("throws for model_judge", () => {
    expect(() => gradeDeterministic({ kind: "model_judge" }, "x")).toThrow(
      /not deterministic/,
    );
  });
});

describe("task fixtures", () => {
  it("parses a valid fixture", () => {
    const parsed = parseTaskFixture(JSON.stringify(tasks));
    expect(parsed).toHaveLength(3);
    expect(parsed[0].taskId).toBe("t/exact");
  });

  it("rejects malformed fixtures with human-readable errors", () => {
    const errors = validateTaskFixture([
      { taskId: "", prompt: 1, grader: { kind: "exact_match" } },
      "not-an-object",
    ]);
    expect(errors).toContain("task[0].taskId must be a non-empty string");
    expect(errors).toContain("task[0].prompt must be a string");
    expect(errors).toContain(
      "task[0].grader.expected must be a string for deterministic graders",
    );
    expect(errors).toContain("task[1] must be an object");
  });

  it("rejects unknown grader kinds", () => {
    const errors = validateTaskFixture([
      { taskId: "x", prompt: "p", grader: { kind: "vibes", expected: "y" } },
    ]);
    expect(errors).toContain("task[0].grader.kind must be a known grader kind");
  });

  it("throws on invalid fixture JSON structure", () => {
    expect(() => parseTaskFixture('{"not":"an array"}')).toThrow(
      /invalid task fixture/,
    );
  });
});
