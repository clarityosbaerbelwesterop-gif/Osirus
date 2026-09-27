import { describe, expect, it } from "vitest";
import {
  coreSpec,
  type FoundationAdapter,
  type FoundationCall,
  type FoundationEvent,
} from "../src/lib/rouge/foundation";
import { checkContract } from "../src/lib/rouge/kernel/contract";
import { contractOf, understand } from "../src/lib/rouge/kernel/understand";
import { defaultPolicy, foundationPolicy } from "../src/lib/rouge/policy";
import { RougeRuntime } from "../src/lib/rouge/runtime";
import { MemoryTelemetry } from "../src/lib/rouge/telemetry";
import type { RougeStreamEvent } from "../src/lib/rouge/types";

// M57: the cognitive kernel's first layer -- understand the request, hold
// the answer to the shape the person fixed, correct itself once when it
// did not, and answer small talk without deliberating.

class Scripted implements FoundationAdapter {
  readonly core = coreSpec("grok-4.6");
  readonly calls: FoundationCall[] = [];
  constructor(private readonly replies: Array<string | Error>) {}
  servedModel(requestId: string) {
    return this.calls.some((call) => call.requestId === requestId)
      ? this.core.id
      : undefined;
  }
  async *stream(call: FoundationCall): AsyncIterable<FoundationEvent> {
    this.calls.push(call);
    const reply = this.replies[this.calls.length - 1] ?? "";
    if (reply instanceof Error) throw reply;
    yield { type: "delta", text: reply };
    yield {
      type: "usage",
      usage: { inputTokens: 10, outputTokens: 5, cost: null },
    };
  }
}

const ask = (content: string) => ({
  requestId: `k-${content.length}`,
  messages: [{ role: "user" as const, content }],
});

async function run(foundation: Scripted, content: string) {
  const telemetry = new MemoryTelemetry();
  const rouge = new RougeRuntime({
    foundation,
    policy: defaultPolicy("grok-4.6"),
    telemetry,
  });
  const events: RougeStreamEvent[] = [];
  for await (const event of rouge.stream(ask(content))) events.push(event);
  const done = events.at(-1);
  if (done?.type !== "done") throw new Error("no answer");
  return { events, response: done.response, telemetry };
}

describe("understanding a request (M57)", () => {
  it("reads the answer shape the person fixed, in English and German", () => {
    const cases: Array<[string, string]> = [
      ["What is 12 * 12? Reply with the number only.", "number"],
      ["Give me just the number: how many legs does a spider have?", "number"],
      ["Wie viel ist 7 mal 8? Antworte nur mit der Zahl.", "number"],
      ["What is 3/4 + 1/8? Answer only with a fraction.", "fraction"],
      ["Who wrote Faust? Reply with the name only.", "word"],
      ["Is 17 prime? Answer with true or false only.", "word"],
      ["Welcher Tag folgt auf Montag? Antworte nur mit dem Wochentag.", "word"],
      ["Describe the sky in exactly four words.", "words"],
      ["Beschreibe den Himmel in genau drei Wörtern.", "words"],
      ["List two planets as JSON only.", "json"],
      ["Gib nur JSON zurück: ein Objekt mit dem Feld name.", "json"],
      ["Explain how photosynthesis works.", "free"],
      ["Write a short poem about autumn.", "free"],
      ["Only if you know it: what is the capital of Mongolia?", "free"],
    ];
    for (const [text, kind] of cases)
      expect(contractOf(text).kind, text).toBe(kind);
  });

  it("keeps the offered options for a one-word answer", () => {
    expect(
      contractOf(
        "Which is heavier? Reply with one word: Iron, Feathers or Same.",
      ),
    ).toEqual({ kind: "word", options: ["Iron", "Feathers", "Same"] });
    expect(contractOf("Is it raining? Reply with yes or no only.")).toEqual({
      kind: "word",
      options: ["yes", "no"],
    });
  });

  it("recognises small talk and the language", () => {
    expect(understand("Hallo!")).toMatchObject({ smallTalk: true });
    expect(understand("Wie viele Minuten hat ein Tag?").language).toBe("de");
    expect(understand("How many minutes are in a day?").language).toBe("en");
  });
});

describe("answer contracts (M57)", () => {
  it("accepts only the fixed shape", () => {
    expect(checkContract({ kind: "number" }, "1651").ok).toBe(true);
    expect(checkContract({ kind: "number" }, "1,651.").ok).toBe(true);
    expect(checkContract({ kind: "number" }, "-12").ok).toBe(true);
    expect(checkContract({ kind: "number" }, "The answer is 1651.").ok).toBe(
      false,
    );
    expect(checkContract({ kind: "fraction" }, "1/6").ok).toBe(true);
    expect(checkContract({ kind: "fraction" }, "0.1667").ok).toBe(false);
    expect(
      checkContract({ kind: "word", options: ["yes", "no"] }, "Yes").ok,
    ).toBe(true);
    expect(
      checkContract({ kind: "word", options: ["yes", "no"] }, "Maybe").ok,
    ).toBe(false);
    expect(checkContract({ kind: "word", options: null }, "Saturday").ok).toBe(
      true,
    );
    expect(
      checkContract({ kind: "word", options: null }, "It was a Saturday").ok,
    ).toBe(false);
    expect(
      checkContract({ kind: "words", count: 3 }, "red yellow blue").ok,
    ).toBe(true);
    expect(checkContract({ kind: "words", count: 3 }, "red and blue").ok).toBe(
      true,
    );
    expect(
      checkContract({ kind: "words", count: 3 }, "red, yellow and blue").ok,
    ).toBe(false);
    expect(checkContract({ kind: "json" }, '{"a": 1}').ok).toBe(true);
    expect(checkContract({ kind: "json" }, '```json\n{"a": 1}\n```').ok).toBe(
      false,
    );
    expect(checkContract({ kind: "free" }, "anything at all").ok).toBe(true);
  });
});

describe("the kernel at work (M57)", () => {
  it("repairs a reply that broke its contract, and shows only the repaired one", async () => {
    const foundation = new Scripted(["The answer is 1651.", "1651"]);
    const { events, response, telemetry } = await run(
      foundation,
      "What is 48 * 37 - 125? Reply with the number only.",
    );
    expect(response.text).toBe("1651");
    expect(response.kernel).toEqual({
      contract: "number",
      contractMet: true,
      repairs: 1,
    });
    // The broken draft never reached the person.
    const deltas = events.filter((event) => event.type === "delta");
    expect(deltas).toEqual([{ type: "delta", text: "1651" }]);
    expect(
      events.map((event) => event.type === "status" && event.label),
    ).toContain("Refining");
    // The core was told the format up front and the reason on repair.
    expect(foundation.calls[0]!.system).toMatch(
      /Required reply format for this message: Reply with the number only/,
    );
    const repair = foundation.calls[1]!;
    expect(repair.messages.at(-2)).toEqual({
      role: "assistant",
      content: "The answer is 1651.",
    });
    expect(repair.messages.at(-1)?.content).toMatch(
      /did not follow the required format: the reply must be only the number/,
    );
    expect(repair.reasoning).toBe("low");
    expect(telemetry.records[0]).toMatchObject({
      contract: "number",
      contractMet: true,
      repairs: 1,
    });
  });

  it("spends no repair on a reply that already fits", async () => {
    const foundation = new Scripted(["Saturday"]);
    const { response } = await run(
      foundation,
      "What day of the week was 1 January 2000? Reply with the weekday only.",
    );
    expect(response.text).toBe("Saturday");
    expect(response.kernel).toMatchObject({ contractMet: true, repairs: 0 });
    expect(foundation.calls).toHaveLength(1);
  });

  it("keeps the draft when the repair does not fit either", async () => {
    const foundation = new Scripted([
      "It is 42, I believe.",
      "Sure! The number is 42.",
    ]);
    const { response } = await run(
      foundation,
      "What comes next: 2, 6, 12, 20, 30? Reply with the number only.",
    );
    expect(response.text).toBe("It is 42, I believe.");
    expect(response.kernel).toMatchObject({ contractMet: false, repairs: 1 });
  });

  it("keeps the draft when the repair call fails", async () => {
    const foundation = new Scripted([
      "It is 42.",
      Object.assign(new Error("busy"), {
        name: "ProviderError",
        code: "rate_limited",
      }),
    ]);
    const { response } = await run(
      foundation,
      "What comes next: 2, 6, 12, 20, 30? Reply with the number only.",
    );
    expect(response.text).toBe("It is 42.");
    expect(response.kernel).toMatchObject({ contractMet: false, repairs: 1 });
  });

  it("streams a free-form answer as it comes, with no check and no repair", async () => {
    const foundation = new Scripted(["Photosynthesis turns light into sugar."]);
    const { events, response } = await run(
      foundation,
      "Explain photosynthesis briefly.",
    );
    expect(response.kernel).toEqual({
      contract: "free",
      contractMet: null,
      repairs: 0,
    });
    expect(foundation.calls[0]!.system).not.toMatch(/Required reply format/);
    expect(events.filter((event) => event.type === "delta")).toHaveLength(1);
  });

  it("answers small talk at quick effort", async () => {
    const foundation = new Scripted(["Hallo! Wie kann ich helfen?"]);
    const { response } = await run(foundation, "Hallo");
    expect(response.effort).toBe("quick");
    expect(foundation.calls[0]!.reasoning).toBe("low");
  });

  it("leaves an explicit effort alone, even for small talk", async () => {
    const foundation = new Scripted(["Hi."]);
    const rouge = new RougeRuntime({ foundation, policy: defaultPolicy() });
    const response = await rouge.respond({ ...ask("hi"), effort: "deep" });
    expect(response.effort).toBe("deep");
  });

  it("does nothing of this under the foundation policy (the baseline)", async () => {
    const foundation = new Scripted(["The answer is 1651."]);
    const rouge = new RougeRuntime({ foundation, policy: foundationPolicy() });
    const response = await rouge.respond(
      ask("What is 48 * 37 - 125? Reply with the number only."),
    );
    expect(response.text).toBe("The answer is 1651.");
    expect(response.kernel).toBeUndefined();
    expect(foundation.calls).toHaveLength(1);
  });
});
