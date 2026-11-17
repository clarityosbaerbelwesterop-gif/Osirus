import { afterEach, describe, expect, it } from "vitest";
import {
  citedSources,
  materialPrompt,
  parseNewsRss,
  relevance,
  wantsNews,
} from "@/lib/gateway/material";
import { chatSystemPrompt } from "@/lib/gateway/prompt";
import {
  curatedModels,
  familyOf,
  resetGatewayModelCache,
  type GatewayModel,
} from "@/lib/gateway/models";
import {
  groupModels,
  type PickerModel,
} from "@/components/agents-chat/model-picker";

// Grok review 2026-11-15: unrelated Wikipedia sources, old news read as
// current, and a picker of 143 models with unknown names.

describe("web sources in chat", () => {
  it("recognises questions about current events", () => {
    expect(wantsNews("Was sind die aktuellen Nachrichten zum Bundestag?")).toBe(
      true,
    );
    expect(wantsNews("What happened today in tech?")).toBe(true);
    expect(wantsNews("Erkläre die Relativitätstheorie")).toBe(false);
    // A word that merely contains "news" is no news question.
    expect(wantsNews("Wie funktioniert ein Newsletter-Tool?")).toBe(false);
  });

  it("drops an article that shares too few of the question's words", () => {
    const album = { title: "Next (Album)", text: "Next ist ein Album von …" };
    const framework = {
      title: "Next.js",
      text: "Next.js ist ein React-Framework. Neuerungen in Version 16 …",
    };
    expect(relevance(album, "next.js neuerungen")).toBeLessThan(0.5);
    expect(relevance(framework, "next.js neuerungen")).toBe(1);
    // Bare numbers and short words do not count either way.
    expect(relevance(album, "16 ab")).toBe(1);
  });

  it("reads dated headlines from a news feed, newest first", () => {
    const xml = `<?xml version="1.0"?><rss><channel><title>Feed</title>
      <item><title><![CDATA[Alte Meldung &amp; mehr - Zeitung A]]></title>
        <link>https://news.example/a</link>
        <pubDate>Mon, 03 Nov 2025 10:00:00 GMT</pubDate>
        <source url="https://a.example">Zeitung A</source></item>
      <item><title>Neue Meldung - Sender B</title>
        <link>https://news.example/b</link>
        <pubDate>Sat, 14 Nov 2026 08:30:00 GMT</pubDate>
        <source url="https://b.example">Sender B</source></item>
      <item><title>Ohne gültigen Link</title><link>javascript:alert(1)</link></item>
      <item><title>Ohne Datum</title><link>https://news.example/c</link></item>
    </channel></rss>`;
    const items = parseNewsRss(xml);
    expect(items.map((item) => item.title)).toEqual([
      "Neue Meldung",
      "Alte Meldung & mehr",
      "Ohne Datum",
    ]);
    expect(items[0]).toMatchObject({
      publisher: "Sender B",
      publishedAt: "2026-11-14T08:30:00.000Z",
    });
    expect(items[2]!.publishedAt).toBeNull();
  });

  it("reads a large feed in linear time", () => {
    const xml = "<item><title>x".repeat(50_000);
    const started = performance.now();
    expect(parseNewsRss(xml)).toEqual([]);
    expect(performance.now() - started).toBeLessThan(500);
  });

  it("gives the model today's date and each source's date and publisher", () => {
    const { prompt, sources } = materialPrompt({
      web: [
        {
          title: "Neue Meldung",
          url: "https://news.example/b",
          text: "Neue Meldung",
          publishedAt: "2026-11-14T08:30:00.000Z",
          publisher: "Sender B",
        },
      ],
      passages: [],
      now: new Date("2026-11-15T12:00:00Z"),
    });
    expect(prompt).toContain("abgerufen am 2026-11-15");
    expect(prompt).toContain("(Sender B, veröffentlicht 2026-11-14)");
    expect(prompt).toMatch(/älter als ein paar Tage/);
    expect(sources[0]!.domain).toBe("Sender B");
  });

  it("keeps only the sources the answer cites", () => {
    const sources = [1, 2, 3, 4].map((n) => ({
      n,
      title: `T${n}`,
      url: `https://s.example/${n}`,
      domain: "s.example",
    }));
    const cited = (text: string) =>
      citedSources(text, sources).map((source) => source.n);
    expect(cited("Laut [2] und [1, 4] stimmt das.")).toEqual([1, 2, 4]);
    expect(cited("Siehe [3][1].")).toEqual([1, 3]);
    expect(cited("Kein Beleg, nur [a] und [99999999999999999999999].")).toEqual(
      [],
    );
    expect(cited("Code: arr[0] = 1")).toEqual([]);
  });

  it("tells the model its own knowledge may be out of date", () => {
    const prompt = chatSystemPrompt({
      botName: null,
      botPrompt: null,
      now: new Date("2026-11-15T12:00:00Z"),
    });
    expect(prompt).toContain("Today is 2026-11-15.");
    expect(prompt).toMatch(/never present older knowledge as the latest/);
  });
});

const model = (id: string, rank: number, extra: Partial<GatewayModel> = {}) =>
  ({
    ref: `openrouter:${id}`,
    provider: "openrouter",
    providerLabel: "OpenRouter",
    id,
    name: id.split("/").pop()!,
    vendor: "x",
    free: false,
    reasoning: false,
    contextLength: null,
    inputPerMillionUsd: null,
    outputPerMillionUsd: null,
    rank,
    ...extra,
  }) as GatewayModel;

describe("curated model list", () => {
  afterEach(() => resetGatewayModelCache());

  it("features one model per known family, never unknown or old ones", () => {
    const models = [
      model("anthropic/claude-sonnet-4.5", 10),
      model("anthropic/claude-opus-4.1", 10),
      model("openai/gpt-5", 12),
      model("google/gemini-2.5-pro", 14),
      model("deepseek/deepseek-v3.2", 20),
      model("thedrummer/darksoul-7b", 80),
      model("meta-llama/llama-2-70b-chat", 50),
      model("qwen/qwen3-coder", 22),
    ];
    const featured = curatedModels(models).map((entry) => entry.id);
    expect(featured).toContain("openai/gpt-5");
    expect(featured).not.toContain("thedrummer/darksoul-7b");
    expect(featured).not.toContain("meta-llama/llama-2-70b-chat");
    // The second Claude only fills up after every family had its turn.
    const claudes = featured.filter((id) => id.includes("claude"));
    expect(claudes).toHaveLength(2);
    expect(featured.at(-1)).toBe(claudes[1]);
    expect(familyOf("thedrummer/darksoul-7b")).toBeNull();
  });

  it("keeps the default and stops at the limit", () => {
    const models = Array.from({ length: 30 }, (_, index) =>
      model(`qwen/qwen3-${index}b`, 22),
    );
    const featured = curatedModels(models, {
      limit: 10,
      keep: ["openrouter:qwen/qwen3-29b"],
    });
    expect(featured).toHaveLength(10);
    expect(featured[0]!.id).toBe("qwen/qwen3-29b");
  });
});

describe("model picker short list", () => {
  const picker = (id: string, tier: PickerModel["tier"] = "top") => ({
    id,
    name: id.toUpperCase(),
    tier,
    free: false,
    reasoning: false,
    contextLength: null,
  });
  const all = [picker("a"), picker("b", "fast"), picker("c"), picker("d")];

  it("shows the recommended models first, in their order, plus the choice", () => {
    const groups = groupModels(all, "", {
      featured: ["c", "a"],
      selected: "d",
    });
    expect(groups).toHaveLength(1);
    expect(groups[0]!.label).toBe("Empfohlen");
    expect(groups[0]!.models.map((entry) => entry.id)).toEqual(["c", "a", "d"]);
  });

  it("shows every model by class when asked, and searches all of them", () => {
    expect(
      groupModels(all, "", { featured: ["a"], showAll: true }).map(
        (group) => group.label,
      ),
    ).toEqual(["Top", "Schnell"]);
    expect(
      groupModels(all, "b", { featured: ["a"] })[0]!.models.map(
        (entry) => entry.id,
      ),
    ).toEqual(["b"]);
  });
});
