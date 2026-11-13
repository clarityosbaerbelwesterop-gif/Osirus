import { describe, expect, it } from "vitest";
import { parseGithubRepository } from "../src/lib/connectors/github";
import { pathSegments } from "../src/lib/connectors/github-tools";
import { classifyAuthority } from "../src/lib/research/authority";
import { isSafeRelativePath } from "../src/lib/sandbox/driver";
import { prepareMath } from "../src/components/chat/markdown";

describe("GitHub paths cannot leave the contents API", () => {
  it("rejects dot segments that the URL parser would resolve", () => {
    // "../collaborators/x" would become /repos/o/n/collaborators/x.
    expect(() => pathSegments("../collaborators/attacker")).toThrow(
      "github_path_invalid",
    );
    expect(() => pathSegments("docs/../../pulls/7/merge")).toThrow();
    expect(() => pathSegments("./README.md")).toThrow();
    expect(pathSegments("/docs/a b.md")).toBe("docs/a%20b.md");
  });

  it("rejects . and .. as repository names", () => {
    expect(parseGithubRepository("https://github.com/acme/..")).toBeNull();
    expect(parseGithubRepository("https://github.com/acme/.")).toBeNull();
    expect(parseGithubRepository("https://github.com/acme/app.js")).toEqual({
      owner: "acme",
      name: "app.js",
    });
  });
});

describe("workspace paths", () => {
  it("never reach git's own directory", () => {
    expect(isSafeRelativePath(".git/hooks/pre-push")).toBe(false);
    expect(isSafeRelativePath("a/.Git/config")).toBe(false);
    expect(isSafeRelativePath(".github/workflows/ci.yml")).toBe(true);
    expect(isSafeRelativePath(".gitignore")).toBe(true);
  });
});

describe("authority", () => {
  it("does not take look-alike domains for Wikipedia", () => {
    expect(classifyAuthority("https://evilwikipedia.org/wiki/X")).not.toBe(
      "reference",
    );
    expect(classifyAuthority("https://de.wikipedia.org/wiki/Moers")).toBe(
      "reference",
    );
  });
});

describe("math in chat messages", () => {
  it("converts \\[..\\] and \\(..\\) as before", () => {
    expect(prepareMath("a \\[x^2\\] b \\(y\\)")).toBe("a $$x^2$$ b $y$");
  });

  it("stays linear on many unclosed \\[", () => {
    const started = performance.now();
    prepareMath("\\[".repeat(200_000));
    expect(performance.now() - started).toBeLessThan(1_000);
  });
});
