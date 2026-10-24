import { describe, expect, it } from "vitest";
import { hiddenChecksOf } from "../src/lib/arms/coding";
import { allowedHiddenTestCommand } from "../src/lib/coding/hidden-command";
import {
  parseCodeOrder,
  parseLiveOrder,
} from "../src/lib/intelligence/rsi/runner-intake";

const ORDER_ID = "11111111-1111-4111-8111-111111111111";

function live(overrides: Record<string, unknown> = {}) {
  return {
    order: {
      orderId: ORDER_ID,
      strategyId: "math.quantitative",
      model: "deepseek-v4-pro-0813:free",
      reserved: 8,
      hypothesis: { statement: "Try a shorter proof." },
      champion: { genome: {} },
      challenger: { genome: {} },
      tasks: [
        {
          id: "t1",
          partition: "holdout",
          spec: {
            kind: "math",
            objective: "What is 6 * 7?",
            verify: { kind: "numeric", value: 42, tolerance: 0 },
          },
        },
      ],
      benchmark: [],
      ...overrides,
    },
  };
}

function code(overrides: Record<string, unknown> = {}) {
  return {
    id: "hypothesis-1",
    calls: 3,
    model: "deepseek-v4-pro-0813:free",
    hypothesis: {
      statement: "The comparator drops a tie.",
      expected: "ties stay ties",
      file: "src/lib/agent/team.ts",
      symbol: "settle",
      arena: "math",
      levels: [1],
      failing: ["tie"],
      trustRoot: false,
      ...overrides,
    },
  };
}

describe("fetched RSI orders", () => {
  it("accepts a bounded math order and nothing executable", () => {
    const parsed = parseLiveOrder(live());
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.order.reserved).toBe(8);
    expect(parsed.order.model).toBe("deepseek-v4-pro-0813:free");
    expect(parsed.order.tasks[0]?.spec.kind).toBe("math");
  });

  it("refuses a shell command, a coding fixture, and an unbounded budget", () => {
    const shell = parseLiveOrder(
      live({
        tasks: [
          {
            id: "t1",
            partition: "dev",
            spec: {
              kind: "coding",
              objective: "run this",
              verify: {
                kind: "tests",
                files: [{ path: "t.js", content: "process.env" }],
                command: ["bash", "-c", "cat /proc/1/environ"],
              },
            },
          },
        ],
      }),
    );
    expect(shell).toEqual({ ok: false, reason: "shape" });

    const budget = parseLiveOrder(live({ reserved: 10_000 }));
    expect(budget).toEqual({ ok: false, reason: "shape" });

    const paid = parseLiveOrder(live({ model: "gpt-4o" }));
    expect(paid).toEqual({ ok: false, reason: "shape" });

    const skills = parseLiveOrder(
      live({
        champion: { genome: { skills: { include: ["exfil@1"] } } },
      }),
    );
    expect(skills).toEqual({ ok: false, reason: "genome_skills" });
  });

  it("refuses a code order outside the allowlist or above three calls", () => {
    expect(parseCodeOrder(code()).ok).toBe(true);
    expect(
      parseCodeOrder(
        code({
          file: "src/lib/auth/server.ts",
          symbol: "auth",
        }),
      ),
    ).toEqual({ ok: false, reason: "file" });
    const body = code();
    expect(parseCodeOrder({ ...body, calls: 40 })).toEqual({
      ok: false,
      reason: "shape",
    });
    expect(parseCodeOrder({ ...body, model: "claude-opus" })).toEqual({
      ok: false,
      reason: "shape",
    });
  });
});

describe("hidden workspace commands", () => {
  it("runs node --test and drops every other command", () => {
    expect(allowedHiddenTestCommand(["node", "--test"])).toBe(true);
    expect(allowedHiddenTestCommand(["node", "--test", "src/a.test.js"])).toBe(
      true,
    );
    expect(allowedHiddenTestCommand(["bash", "-c", "printenv"])).toBe(false);
    expect(
      allowedHiddenTestCommand(["node", "--test", "/proc/1/environ"]),
    ).toBe(false);
    expect(
      hiddenChecksOf({
        hiddenChecks: {
          files: [{ path: "t.js", content: "test" }],
          command: ["bash", "-c", "cat /proc/1/environ"],
        },
      }),
    ).toBeNull();
    expect(
      hiddenChecksOf({
        hiddenChecks: {
          files: [{ path: "t.js", content: "test" }],
          command: ["node", "--test"],
        },
      }),
    ).toEqual({
      files: [{ path: "t.js", content: "test" }],
      command: ["node", "--test"],
    });
  });
});
