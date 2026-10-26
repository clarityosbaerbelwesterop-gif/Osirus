import { afterEach, describe, expect, it } from "vitest";
import {
  noteModelResult,
  resetGatewayModelCache,
  verifiedLead,
  verifiedTopModels,
  type GatewayModel,
} from "@/lib/gateway/models";
import {
  botTier,
  botWantsCoding,
  candidatesFor,
  classifyDifficulty,
  higherTier,
  tierOf,
  wantsReasoning,
} from "@/lib/gateway/routing";

function model(id: string, rank: number, extra: Partial<GatewayModel> = {}) {
  return {
    ref: `openrouter:${id}`,
    provider: "openrouter",
    providerLabel: "OpenRouter",
    id,
    name: id,
    vendor: "x",
    free: false,
    reasoning: false,
    contextLength: null,
    inputPerMillionUsd: 1,
    outputPerMillionUsd: 2,
    rank,
    ...extra,
  } as GatewayModel;
}

const MODELS = [
  model("openai/gpt-5", 12),
  model("anthropic/claude-sonnet-4.5", 10),
  model("deepseek/deepseek-r1", 20, { reasoning: true }),
  model("qwen/qwen3-coder", 22),
  model("meta-llama/llama-3.3-70b-instruct", 34),
  model("mistralai/mistral-medium", 36),
  model("google/gemini-2.5-flash", 32),
  model("openai/gpt-5-mini", 16),
];

describe("model classes", () => {
  it("puts small models in fast, frontier families in top, the rest in balanced", () => {
    expect(tierOf(model("google/gemini-2.5-flash", 32))).toBe("fast");
    expect(tierOf(model("openai/gpt-5-mini", 16))).toBe("fast");
    expect(tierOf(model("meta-llama/llama-3.1-8b-instruct", 50))).toBe("fast");
    expect(tierOf(model("openai/gpt-5", 12))).toBe("top");
    expect(tierOf(model("meta-llama/llama-3.3-70b-instruct", 34))).toBe(
      "balanced",
    );
  });

  it("only moves a thread up", () => {
    expect(higherTier("balanced", "fast")).toBe("balanced");
    expect(higherTier("fast", "top")).toBe("top");
  });
});

describe("difficulty", () => {
  it("answers greetings fast and hard, long work with the top class", () => {
    expect(classifyDifficulty({ message: "Hallo!" }).tier).toBe("fast");
    expect(classifyDifficulty({ message: "Danke" }).tier).toBe("fast");
    expect(
      classifyDifficulty({ message: "Was ist die Hauptstadt von Frankreich?" })
        .tier,
    ).toBe("fast");
    expect(
      classifyDifficulty({
        message:
          "Schreib mir bitte eine kurze, freundliche Antwort auf die Einladung zum Abendessen am Freitag.",
      }).tier,
    ).toBe("balanced");
    expect(
      classifyDifficulty({
        message:
          "Analysiere die Architektur unserer Datenbank-Migration und bewerte Sicherheit und Performance.",
      }).tier,
    ).toBe("top");
    expect(
      classifyDifficulty({ message: "x".repeat(2000) + " function a() {}" })
        .tier,
    ).toBe("top");
  });

  it("weighs a long thread and attachments", () => {
    const base = { message: "Und wie geht das in Python genau?" };
    expect(classifyDifficulty(base).score).toBeLessThan(
      classifyDifficulty({ ...base, historyChars: 9000, attachments: 1 }).score,
    );
  });

  it("sends proofs and maths to a thinking model first", () => {
    expect(wantsReasoning("Beweise, dass die Gleichung keine Lösung hat")).toBe(
      true,
    );
    expect(wantsReasoning("Schreib ein Gedicht")).toBe(false);
  });
});

describe("bots", () => {
  it("gives expert roles the top class", () => {
    expect(
      botTier({ name: "Ada", system_prompt: "Rolle: Software Engineer." }),
    ).toBe("top");
    expect(botTier({ name: "Database Manufactor" })).toBe("top");
    expect(botTier({ name: "Rechtsberater", system_prompt: "Jurist" })).toBe(
      "top",
    );
    expect(botTier({ name: "Übersetzer" })).toBe("fast");
    expect(botTier({ name: "Mia", system_prompt: "Sei freundlich." })).toBe(
      "balanced",
    );
  });

  it("prefers coding models for engineering bots", () => {
    expect(botWantsCoding({ name: "Software Engineer" })).toBe(true);
    const [first] = candidatesFor(MODELS, "top", { coding: true });
    expect(first.id).toMatch(/claude|gpt-5|qwen3-coder/);
  });
});

describe("candidates", () => {
  it("orders the class first, then the stronger, then the weaker", () => {
    const top = candidatesFor(MODELS, "top").map((m) => tierOf(m));
    expect(top[0]).toBe("top");
    expect(top.at(-1)).toBe("fast");
    const fast = candidatesFor(MODELS, "fast").map((m) => tierOf(m));
    expect(fast[0]).toBe("fast");
  });

  it("keeps thinking models out of front unless asked", () => {
    const plain = candidatesFor(MODELS, "top");
    expect(plain[0].reasoning).toBe(false);
    const thinking = candidatesFor(MODELS, "top", { reasoning: true });
    expect(thinking[0].reasoning).toBe(true);
  });

  it("is deterministic, so a bot keeps one model", () => {
    const a = candidatesFor(MODELS, "top", { coding: true })[0].ref;
    const b = candidatesFor([...MODELS].reverse(), "top", { coding: true })[0]
      .ref;
    expect(a).toBe(b);
  });
});

describe("measured models lead", () => {
  afterEach(() => {
    delete process.env.OSIRUS_VERIFIED_TOP_MODELS;
    resetGatewayModelCache();
  });

  it("puts lead models first, once, and keeps the limit", () => {
    const lead = MODELS.filter((m) => tierOf(m) === "balanced").slice(0, 1);
    const list = candidatesFor(MODELS, "top", { lead, limit: 3 });
    expect(list[0].ref).toBe(lead[0].ref);
    expect(list).toHaveLength(3);
    expect(new Set(list.map((m) => m.ref)).size).toBe(3);
  });

  it("leads the top class with the probed top models, in probe order", () => {
    const top = MODELS.filter((m) => tierOf(m) === "top");
    const [a, b] = [top.at(-1)!, top[0]];
    process.env.OSIRUS_VERIFIED_TOP_MODELS = `${a.ref}, openrouter:gone/model ,${b.ref}`;
    expect(verifiedTopModels(MODELS).map((m) => m.ref)).toEqual([a.ref, b.ref]);
    expect(verifiedLead(MODELS, "top").map((m) => m.ref)).toEqual([
      a.ref,
      b.ref,
    ]);
    expect(
      candidatesFor(MODELS, "top", { lead: verifiedLead(MODELS, "top") })[0]
        .ref,
    ).toBe(a.ref);
  });

  it("drops a probed model that failed since, and non-thinkers for proofs", () => {
    const top = MODELS.filter((m) => tierOf(m) === "top");
    process.env.OSIRUS_VERIFIED_TOP_MODELS = top.map((m) => m.ref).join(",");
    noteModelResult(top[0].ref, { ok: false, firstTokenMs: 0 });
    expect(verifiedLead(MODELS, "top").map((m) => m.ref)).not.toContain(
      top[0].ref,
    );
    expect(
      verifiedLead(MODELS, "top", { reasoning: true }).every(
        (m) => m.reasoning,
      ),
    ).toBe(true);
  });
});
