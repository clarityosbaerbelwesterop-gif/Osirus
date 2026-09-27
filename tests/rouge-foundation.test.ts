import { describe, expect, it } from "vitest";
import {
  coreSpec,
  type CoreSpec,
  type FoundationAdapter,
  type FoundationCall,
  type FoundationEvent,
} from "../src/lib/rouge/foundation";
import { UnoRouterFoundation } from "../src/lib/rouge/foundations/unorouter";
import {
  defaultPolicy,
  identityInstruction,
  reasoningFor,
  versionOf,
} from "../src/lib/rouge/policy";
import { RougeRuntime } from "../src/lib/rouge/runtime";
import { MemoryTelemetry } from "../src/lib/rouge/telemetry";
import { RougeError, type RougeStreamEvent } from "../src/lib/rouge/types";
import type { ModelProvider } from "../src/lib/models/provider";

// M56: Rouge's foundation. What must hold before any cognition is added:
// the core is swappable behind an adapter, effort maps onto the core's own
// reasoning levels, a substituted core is always labelled, evaluations can
// forbid substitution, refusals stay honest, and telemetry never carries
// content.

const GROK = coreSpec("grok-4.6");

class FakeFoundation implements FoundationAdapter {
  readonly calls: FoundationCall[] = [];
  constructor(
    readonly core: CoreSpec,
    private readonly behaviour: {
      chunks?: string[];
      served?: string;
      fail?: Error;
      usage?: {
        inputTokens: number;
        outputTokens: number;
        cost: number | null;
      };
    } = {},
  ) {}
  servedModel(requestId: string) {
    return this.calls.some((call) => call.requestId === requestId)
      ? (this.behaviour.served ?? this.core.id)
      : undefined;
  }
  async *stream(call: FoundationCall): AsyncIterable<FoundationEvent> {
    this.calls.push(call);
    if (this.behaviour.fail) throw this.behaviour.fail;
    for (const text of this.behaviour.chunks ?? [
      "Hallo! ",
      "Wie kann ich helfen?",
    ])
      yield { type: "delta", text };
    yield {
      type: "usage",
      usage: this.behaviour.usage ?? {
        inputTokens: 12,
        outputTokens: 7,
        cost: null,
      },
    };
  }
}

function providerError(code: string, message = code) {
  return Object.assign(new Error(message), {
    name: "ProviderError",
    code,
    retryAfterMs: null,
  });
}

async function collect(stream: AsyncIterable<RougeStreamEvent>) {
  const events: RougeStreamEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

const hello = {
  requestId: "r-1",
  messages: [{ role: "user" as const, content: "Hallo" }],
};

describe("Rouge runtime (M56)", () => {
  it("answers through the foundation with its identity, version and honest core", async () => {
    const foundation = new FakeFoundation(GROK);
    const telemetry = new MemoryTelemetry();
    let clock = 1_000;
    const rouge = new RougeRuntime({
      foundation,
      policy: defaultPolicy("grok-4.6"),
      telemetry,
      now: () => (clock += 10),
    });
    const events = await collect(rouge.stream(hello));
    expect(events[0]).toEqual({ type: "status", label: "Thinking" });
    const done = events.at(-1);
    expect(done?.type).toBe("done");
    const response = done?.type === "done" ? done.response : null;
    expect(response).toMatchObject({
      text: "Hallo! Wie kann ich helfen?",
      effort: "standard",
      version: { name: "Rouge 1", policy: "p0", core: "grok-4.6" },
      core: { requested: "grok-4.6", served: "grok-4.6", substituted: false },
      usage: { inputTokens: 12, outputTokens: 7, cost: null },
    });
    expect(response!.firstTokenMs).not.toBeNull();

    const [call] = foundation.calls;
    expect(call!.system).toMatch(/You are Rouge 1/);
    expect(call!.system).toMatch(/grok-4\.6 foundation model/);
    expect(call!.reasoning).toBe("medium");
    expect(call!.allowSubstitute).toBe(true);

    // Telemetry: numbers and labels, never the conversation.
    expect(telemetry.records).toHaveLength(1);
    const record = telemetry.records[0]!;
    expect(record).toMatchObject({
      outcome: "completed",
      coreRequested: "grok-4.6",
      coreServed: "grok-4.6",
      substituted: false,
      effort: "standard",
      reasoning: "medium",
    });
    const serialized = JSON.stringify(record);
    expect(serialized).not.toContain("Hallo");
    expect(serialized).not.toContain("helfen");
  });

  it("maps effort onto the core's reasoning levels, never above what was asked", () => {
    const policy = defaultPolicy();
    const all = GROK.reasoningLevels;
    expect(reasoningFor(policy, "quick", all)).toBe("low");
    expect(reasoningFor(policy, "standard", all)).toBe("medium");
    expect(reasoningFor(policy, "deep", all)).toBe("high");
    expect(reasoningFor(policy, "ultra", all)).toBe("xhigh");
    // A core without that level gets the closest lower one.
    expect(reasoningFor(policy, "ultra", ["low", "high"])).toBe("high");
    expect(reasoningFor(policy, "standard", ["low", "high"])).toBe("low");
    // A core with no reasoning control gets none.
    expect(reasoningFor(policy, "deep", [])).toBeUndefined();
    // xhigh is reachable only through ultra.
    expect(
      Object.entries(policy.effortMap).filter(([, level]) => level === "xhigh"),
    ).toEqual([["ultra", "xhigh"]]);
  });

  it("labels an answer served by a substitute core", async () => {
    const telemetry = new MemoryTelemetry();
    const rouge = new RougeRuntime({
      foundation: new FakeFoundation(GROK, {
        served: "nemotron-3-ultra-550b-a55b:free",
      }),
      policy: defaultPolicy(),
      telemetry,
    });
    const response = await rouge.respond(hello);
    expect(response.core).toEqual({
      requested: "grok-4.6",
      served: "nemotron-3-ultra-550b-a55b:free",
      substituted: true,
    });
    expect(telemetry.records[0]).toMatchObject({ substituted: true });
  });

  it("lets an evaluation forbid substitution", async () => {
    const foundation = new FakeFoundation(GROK);
    const rouge = new RougeRuntime({
      foundation,
      policy: defaultPolicy(),
      allowCoreSubstitute: false,
    });
    await rouge.respond({ ...hello, effort: "ultra" });
    expect(foundation.calls[0]).toMatchObject({
      allowSubstitute: false,
      reasoning: "xhigh",
    });
  });

  it("reports a refusal of the core honestly, with its code", async () => {
    const telemetry = new MemoryTelemetry();
    const rouge = new RougeRuntime({
      foundation: new FakeFoundation(GROK, {
        fail: providerError("insufficient_credit", "no credit left"),
      }),
      policy: defaultPolicy(),
      telemetry,
      allowCoreSubstitute: false,
    });
    const error = await rouge.respond(hello).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(RougeError);
    expect(error).toMatchObject({ code: "insufficient_credit" });
    expect(telemetry.records[0]).toMatchObject({
      outcome: "failed",
      errorCode: "insufficient_credit",
    });
  });

  it("records a cancelled request as cancelled", async () => {
    const controller = new AbortController();
    controller.abort();
    const telemetry = new MemoryTelemetry();
    const rouge = new RougeRuntime({
      foundation: new FakeFoundation(GROK, { fail: new Error("aborted") }),
      policy: defaultPolicy(),
      telemetry,
    });
    await expect(
      rouge.respond({ ...hello, signal: controller.signal }),
    ).rejects.toMatchObject({ code: "cancelled" });
    expect(telemetry.records[0]?.outcome).toBe("cancelled");
  });

  it("refuses an empty answer instead of returning nothing", async () => {
    const rouge = new RougeRuntime({
      foundation: new FakeFoundation(GROK, { chunks: ["", "  "] }),
      policy: defaultPolicy(),
    });
    await expect(rouge.respond(hello)).rejects.toMatchObject({
      code: "empty_answer",
    });
  });

  it("validates requests before spending a call", async () => {
    const foundation = new FakeFoundation(GROK);
    const rouge = new RougeRuntime({ foundation, policy: defaultPolicy() });
    for (const messages of [
      [],
      [{ role: "assistant" as const, content: "hi" }],
      [{ role: "user" as const, content: "   " }],
    ]) {
      await expect(
        rouge.respond({ requestId: "bad", messages }),
      ).rejects.toMatchObject({ code: "invalid_request" });
    }
    expect(foundation.calls).toHaveLength(0);
  });

  it("refuses a policy written for a different core", () => {
    expect(
      () =>
        new RougeRuntime({
          foundation: new FakeFoundation(GROK),
          policy: defaultPolicy("grok-5"),
        }),
    ).toThrow(/core_mismatch|Policy is for grok-5/);
  });

  it("states its identity truthfully", () => {
    const text = identityInstruction({
      version: versionOf(defaultPolicy()),
      foundation: "grok-4.6",
      now: new Date("2026-09-27T12:00:00Z"),
    });
    expect(text).toMatch(/Rouge 1/);
    expect(text).toMatch(/runs on the grok-4\.6 foundation model/);
    expect(text).toMatch(/Do not claim to have been trained from scratch/);
    expect(text).toMatch(/2026-09-27/);
  });
});

describe("UnoRouter foundation (M56)", () => {
  it("pins every call to the core and passes effort, substitution and priority", async () => {
    const seen: Array<Record<string, unknown>> = [];
    const streamed: Array<Record<string, unknown>> = [];
    const provider = (options: Record<string, unknown>) => {
      seen.push(options);
      return {
        async *stream(input: Record<string, unknown>) {
          streamed.push(input);
          yield { type: "delta" as const, text: "ok" };
          yield {
            type: "usage" as const,
            usage: { inputTokens: 3, outputTokens: 1 },
          };
        },
        servedModel: () => "grok-4.6",
      } as unknown as ModelProvider;
    };
    const foundation = new UnoRouterFoundation(GROK, { provider });
    const events: FoundationEvent[] = [];
    for await (const event of foundation.stream({
      requestId: "u-1",
      system: "identity",
      messages: [{ role: "user", content: "Hallo" }],
      reasoning: "high",
      allowSubstitute: false,
    }))
      events.push(event);
    expect(seen[0]).toMatchObject({
      model: "grok-4.6",
      reasoningEffort: "high",
      fallback: false,
      priority: "P0",
    });
    expect(streamed[0]).toMatchObject({
      role: "STRONG",
      messages: [
        { role: "system", content: "identity" },
        { role: "user", content: "Hallo" },
      ],
    });
    expect(events).toEqual([
      { type: "delta", text: "ok" },
      { type: "usage", usage: { inputTokens: 3, outputTokens: 1, cost: null } },
    ]);
    expect(foundation.servedModel("u-1")).toBe("grok-4.6");
  });

  it("sends no reasoning field to a core without reasoning control", async () => {
    const seen: Array<Record<string, unknown>> = [];
    const foundation = new UnoRouterFoundation(coreSpec("some-new-core"), {
      provider: (options) => {
        seen.push(options as Record<string, unknown>);
        return {
          async *stream() {
            yield { type: "delta" as const, text: "ok" };
          },
        } as unknown as ModelProvider;
      },
    });
    for await (const _event of foundation.stream({
      requestId: "u-2",
      system: "s",
      messages: [{ role: "user", content: "x" }],
      reasoning: "high",
      allowSubstitute: true,
    })) {
      void _event;
    }
    expect(seen[0]?.reasoningEffort).toBeUndefined();
  });
});
