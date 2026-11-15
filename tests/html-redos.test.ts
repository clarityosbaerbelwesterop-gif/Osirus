import { describe, expect, it } from "vitest";
import { decodeEntities, htmlToText } from "../src/lib/research/fetch";

// A fetched page is attacker-controlled. The old regexes took quadratic time
// on unclosed markup (512 KB of "<!--" took 34 s) and blocked the function.

const PAGES = {
  comments: "<!--".repeat(500_000),
  scripts: "<script".repeat(280_000),
  tags: "<".repeat(2_000_000),
  metas: "<meta name='og:title' ".repeat(90_000),
  titles: "<title".repeat(330_000),
};

describe("htmlToText on hostile pages", () => {
  for (const [name, page] of Object.entries(PAGES))
    it(`stays linear on 2 MB of ${name}`, () => {
      const started = performance.now();
      htmlToText(page);
      expect(performance.now() - started).toBeLessThan(1_500);
    });

  it("still reads a normal page", () => {
    const result = htmlToText(
      `<html><head><title>Moers &amp; mehr</title><meta property="og:site_name" content="Stadt"><meta name="date" content="2026-01-02"></head><body><nav>Menü</nav><!-- x --><p>Einwohner: 104.000</p><script>alert(1)</script><div>Quelle</div></body></html>`,
    );
    expect(result.title).toBe("Moers & mehr");
    expect(result.publisher).toBe("Stadt");
    expect(result.publishedAt).toBe("2026-01-02");
    expect(result.text).toContain("Einwohner: 104.000");
    expect(result.text).toContain("Quelle");
    expect(result.text).not.toMatch(/alert|Menü/);
  });

  it("keeps a lone '<' in text", () => {
    expect(htmlToText("<p>a < b</p>").text).toContain("a < b");
  });

  it("does not throw on out-of-range character references", () => {
    expect(decodeEntities("x&#x110000;y&#0;z")).toBe("x y z");
  });
});
