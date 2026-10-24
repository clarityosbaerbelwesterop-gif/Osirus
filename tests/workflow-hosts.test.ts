import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const dir = join(__dirname, "..", ".github", "workflows");

describe("workflow hosts", () => {
  it("never sends a request to the unrelated osirus.vercel.app host", () => {
    for (const name of readdirSync(dir)) {
      const text = readFileSync(join(dir, name), "utf8");
      const urls = text.match(/https?:\/\/osirus\.vercel\.app[^\s'"]*/g) ?? [];
      expect(urls, name).toEqual([]);
    }
  });
});
