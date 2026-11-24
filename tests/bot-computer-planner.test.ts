import { beforeEach, describe, expect, it, vi } from "vitest";

// The bot computer's planner: a model that does not follow the format does
// not end the plan; the next model gets the question. A clear "no command"
// is respected.

const replies = vi.hoisted(() => ({ queue: [] as Array<string | Error> }));

vi.mock("../src/lib/gateway/stream", () => ({
  completeGateway: async () => {
    const next = replies.queue.shift();
    if (next instanceof Error) throw next;
    return { text: next ?? "", usage: {} };
  },
}));
vi.mock("../src/lib/gateway/usage", () => ({
  recordGatewayCall: async () => undefined,
  estimateTokens: () => 1,
}));

const models = [
  { ref: "a:weak", provider: "a" },
  { ref: "b:strong", provider: "b" },
] as never;

async function plan() {
  const { modelPlanner } = await import("../src/lib/agents/bot-computer");
  return modelPlanner({
    identity: {} as never,
    sessionId: "s",
    models,
    botName: "Rechner",
    message: "Rechne mit Python auf deinem Computer 2 hoch 64 aus",
  })([]);
}

beforeEach(() => {
  replies.queue = [];
  vi.spyOn(console, "info").mockImplementation(() => undefined);
});

describe("the bot computer's planner", () => {
  it("asks the next model when one answers in prose", async () => {
    replies.queue = [
      "2 hoch 64 ist 18446744073709551616.",
      '{"command": "python3 -c \\"print(2**64)\\"", "reason": "Rechnet"}',
    ];
    expect(await plan()).toEqual({
      command: 'python3 -c "print(2**64)"',
      reason: "Rechnet",
    });
  });

  it("asks the next model when one fails", async () => {
    replies.queue = [
      Object.assign(new Error("busy"), { code: "rate_limited" }),
      '{"command": "echo 1", "reason": ""}',
    ];
    expect((await plan())?.command).toBe("echo 1");
  });

  it("respects a clear decline", async () => {
    replies.queue = ['{"command": null, "reason": "Kein Computer nötig"}'];
    expect(await plan()).toBeNull();
    expect(replies.queue).toEqual([]);
  });

  it("tells the planner that an explicit request needs a command", async () => {
    const { computerPlanMessages } =
      await import("../src/lib/agents/bot-computer-plan");
    const [system] = computerPlanMessages({
      botName: "R",
      message: "x",
      steps: [],
    });
    expect(system!.content).toMatch(/you must give a command/);
  });
});
