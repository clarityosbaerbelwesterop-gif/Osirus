import { describe, expect, it } from "vitest";
import {
  canonicalGithubCloneUrl,
  cloneBranch,
  cloneDepth,
} from "../src/lib/coding/clone-target";

describe("github clone target", () => {
  it("canonicalizes an https github owner/name URL", () => {
    expect(canonicalGithubCloneUrl("https://github.com/osirus/stats-lib")).toBe(
      "https://github.com/osirus/stats-lib.git",
    );
    expect(
      canonicalGithubCloneUrl("https://github.com/osirus/stats-lib.git"),
    ).toBe("https://github.com/osirus/stats-lib.git");
  });

  it("refuses other hosts, credentials, queries, and extra path", () => {
    for (const input of [
      "https://github.com.evil.test/osirus/stats-lib",
      "https://example.com/osirus/stats-lib",
      "http://github.com/osirus/stats-lib",
      "https://user:token@github.com/osirus/stats-lib",
      "https://github.com/osirus/stats-lib?ref=main",
      "https://github.com/osirus/stats-lib/tree/main",
      "https://github.com/osirus/stats-lib#frag",
      "not a url",
    ]) {
      expect(() => canonicalGithubCloneUrl(input)).toThrow(
        "only_https_github_clones_are_supported",
      );
    }
  });

  it("refuses a branch that is not a plain ref, and bounds depth", () => {
    expect(cloneBranch(undefined)).toBeUndefined();
    expect(cloneBranch("osirus/fix-median")).toBe("osirus/fix-median");
    expect(() => cloneBranch("-c")).toThrow("branch_name_invalid");
    expect(() => cloneBranch("a..b")).toThrow("branch_name_invalid");
    expect(cloneDepth(undefined)).toBe("50");
    expect(cloneDepth(1)).toBe("1");
    expect(() => cloneDepth(0)).toThrow("clone_depth_invalid");
    expect(() => cloneDepth(201)).toThrow("clone_depth_invalid");
    expect(() => cloneDepth(1.5)).toThrow("clone_depth_invalid");
  });
});
