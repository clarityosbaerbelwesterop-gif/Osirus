import { describe, expect, it } from "vitest";
import type { ToolEvidence } from "../src/lib/agent/toolbox";
import { classifyAuthority } from "../src/lib/research/authority";
import { fallbackFetchUrls } from "../src/lib/research/fallback";

// Live 2026-11-06: three research workers spent their tool budget on
// searches and fetched nothing. Their own search results still hold the
// sources; the best of them are fetched for the worker.

const search = (urls: string[], ok = true): ToolEvidence => ({
  toolId: "research.search",
  input: { query: "Einwohner Moers" },
  ok,
  data: { hits: urls.map((url) => ({ url, title: url, snippet: "" })) },
});

describe("fallback fetch from a worker's own search results", () => {
  it("picks the most authoritative unfetched URLs, then the order found", () => {
    const urls = [
      "https://example-blog.com/moers",
      "https://en.wikipedia.org/wiki/Moers",
      "https://www.destatis.de/DE/Themen/Gesellschaft-Umwelt/Bevoelkerung",
    ];
    const ranked = fallbackFetchUrls([search(urls)], 3);
    expect(ranked).toHaveLength(3);
    expect(new Set(ranked)).toEqual(new Set(urls));
    const order = [
      "primary",
      "official_docs",
      "reference",
      "news",
      "secondary",
      "community",
    ];
    const ranks = ranked.map((url) => order.indexOf(classifyAuthority(url)));
    expect([...ranks].sort((a, b) => a - b)).toEqual(ranks);
  });

  it("skips already fetched, duplicate, failed and non-web results", () => {
    const evidence: ToolEvidence[] = [
      search(["https://a.example/1", "https://a.example/1", "ftp://x/y"]),
      search(["https://b.example/2"], false),
      {
        toolId: "research.fetch",
        input: { url: "https://a.example/1" },
        ok: true,
        data: {},
      },
      search(["https://c.example/3"]),
    ];
    expect(fallbackFetchUrls(evidence)).toEqual(["https://c.example/3"]);
  });

  it("returns nothing without search hits and respects the limit", () => {
    expect(fallbackFetchUrls([])).toEqual([]);
    expect(
      fallbackFetchUrls([
        search([
          "https://a.example/1",
          "https://a.example/2",
          "https://a.example/3",
        ]),
      ]),
    ).toHaveLength(2);
  });
});
