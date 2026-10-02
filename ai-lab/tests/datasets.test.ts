/**
 * AI Lab — data pipeline tests (Phase J).
 *
 * Covers the pure pipeline stages in ai-lab/datasets/pipeline.ts: license
 * filtering, exact and near dedup, eval-set decontamination, and repo-level
 * dependency ordering including the cyclic fallback. Picked up by the root
 * vitest gate via `ai-lab/tests/**` in vitest.config.ts.
 */

import { describe, expect, it } from "vitest";

import {
  DEFAULT_LICENSE_POLICY,
  decontaminate,
  exactDedup,
  extractImportSpecifiers,
  fnv1aHash,
  isLicenseAllowed,
  jaccardSimilarity,
  licenseFilter,
  nearDedup,
  repoOrder,
  tokenShingles,
  type DataRecord,
  type RepoFile,
} from "../datasets/pipeline";

function record(partial: Partial<DataRecord> & { id: string }): DataRecord {
  return { content: "", ...partial };
}

describe("fnv1aHash", () => {
  it("is deterministic and content-sensitive", () => {
    expect(fnv1aHash("hello")).toBe(fnv1aHash("hello"));
    expect(fnv1aHash("hello")).not.toBe(fnv1aHash("world"));
  });
});

describe("licenseFilter", () => {
  it("keeps records with allowlisted permissive licenses", () => {
    const records = [
      record({ id: "a", license: "Apache-2.0" }),
      record({ id: "b", license: "MIT" }),
      record({ id: "c", license: "Unlicense" }),
    ];
    expect(licenseFilter(records).map((r) => r.id)).toEqual(["a", "b", "c"]);
  });

  it("matches prefix globs for bsd-* and cc-by-* families", () => {
    expect(isLicenseAllowed("BSD-3-Clause", DEFAULT_LICENSE_POLICY)).toBe(true);
    expect(isLicenseAllowed("bsd-2-clause", DEFAULT_LICENSE_POLICY)).toBe(true);
    expect(isLicenseAllowed("CC-BY-4.0", DEFAULT_LICENSE_POLICY)).toBe(true);
    expect(isLicenseAllowed("CC-BY-SA-4.0", DEFAULT_LICENSE_POLICY)).toBe(true);
  });

  it("drops copyleft, non-commercial, and missing licenses", () => {
    const records = [
      record({ id: "gpl", license: "GPL-3.0" }),
      record({ id: "agpl", license: "AGPL-3.0" }),
      record({ id: "nc", license: "CC-BY-NC-4.0" }),
      record({ id: "none" }),
      record({ id: "empty", license: "  " }),
      record({ id: "ok", license: "MIT" }),
    ];
    expect(licenseFilter(records).map((r) => r.id)).toEqual(["ok"]);
  });

  it("honors the per-record opt-out flag and the policy opt-out list", () => {
    const records = [
      record({ id: "flagged", license: "MIT", optOut: true }),
      record({ id: "listed", license: "MIT" }),
      record({ id: "kept", license: "MIT" }),
    ];
    const kept = licenseFilter(records, {
      ...DEFAULT_LICENSE_POLICY,
      optedOutIds: ["listed"],
    });
    expect(kept.map((r) => r.id)).toEqual(["kept"]);
  });
});

describe("exactDedup", () => {
  it("removes identical content, keeps the first occurrence, preserves order", () => {
    const records = [
      record({ id: "a", content: "x = 1" }),
      record({ id: "b", content: "y = 2" }),
      record({ id: "c", content: "x = 1" }),
      record({ id: "d", content: "y = 2" }),
    ];
    expect(exactDedup(records).map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("keeps distinct contents untouched", () => {
    const records = [
      record({ id: "a", content: "one" }),
      record({ id: "b", content: "two" }),
      record({ id: "c", content: "three" }),
    ];
    expect(exactDedup(records)).toHaveLength(3);
  });
});

describe("nearDedup", () => {
  const base =
    "def quicksort(items) if len(items) <= 1 return items pivot = items[0] " +
    "rest = items[1:] left = [x for x in rest if x < pivot] " +
    "right = [x for x in rest if x >= pivot] " +
    "return quicksort(left) + [pivot] + quicksort(right)";

  it("drops a near-duplicate with a small edit", () => {
    const edited = base.replace("quicksort(items)", "quicksort(values)");
    const kept = nearDedup([
      record({ id: "orig", content: base }),
      record({ id: "edit", content: edited }),
    ]);
    expect(kept.map((r) => r.id)).toEqual(["orig"]);
  });

  it("keeps dissimilar records", () => {
    const other =
      "SELECT name, COUNT(*) FROM users GROUP BY name HAVING COUNT(*) > 10 " +
      "ORDER BY COUNT(*) DESC LIMIT 100 OFFSET 20";
    const kept = nearDedup([
      record({ id: "code", content: base }),
      record({ id: "sql", content: other }),
    ]);
    expect(kept).toHaveLength(2);
  });

  it("respects a stricter Jaccard threshold", () => {
    const edited = base.replace("quicksort(items)", "quicksort(values)");
    const kept = nearDedup(
      [
        record({ id: "orig", content: base }),
        record({ id: "edit", content: edited }),
      ],
      { threshold: 0.99 },
    );
    expect(kept).toHaveLength(2);
  });

  it("rejects band counts that do not divide the signature size", () => {
    expect(() =>
      nearDedup([record({ id: "a", content: base })], {
        signatureSize: 10,
        bands: 3,
      }),
    ).toThrow("signatureSize must be divisible by bands");
  });
});

describe("shingle/jaccard helpers", () => {
  it("treats two empty shingle sets as identical", () => {
    expect(jaccardSimilarity(new Set(), new Set())).toBe(1);
  });

  it("produces n-1 shingles of size n for a token stream", () => {
    expect(tokenShingles("a b c d e", 3).size).toBe(3);
  });
});

describe("decontaminate", () => {
  const evalTask =
    "write a function add that takes two integers and returns their sum " +
    "for example add one two equals three and add minus one one equals zero";

  it("removes records sharing a 13-gram with an eval fingerprint", () => {
    const contaminated = record({
      id: "leak",
      content: `solution: ${evalTask} done`,
    });
    const clean = record({
      id: "clean",
      content:
        "completely unrelated prose about database indexes and query plans " +
        "with no overlap whatsoever to the evaluation task at hand here",
    });
    const kept = decontaminate([contaminated, clean], [evalTask]);
    expect(kept.map((r) => r.id)).toEqual(["clean"]);
  });

  it("keeps records with no n-gram overlap", () => {
    const clean = record({
      id: "clean",
      content: "x y z " + "alpha beta gamma delta ".repeat(10),
    });
    expect(decontaminate([clean], [evalTask])).toHaveLength(1);
  });

  it("handles texts shorter than the n-gram size via whole-text grams", () => {
    const short = record({ id: "short", content: "return the sum" });
    expect(decontaminate([short], ["return the sum"])).toHaveLength(0);
    expect(decontaminate([short], ["something else entirely"])).toHaveLength(1);
  });
});

describe("repoOrder", () => {
  it("orders dependencies before their importers (ts import … from)", () => {
    const files: RepoFile[] = [
      { path: "src/main.ts", content: 'import { run } from "./app";\nrun();' },
      {
        path: "src/app.ts",
        content: 'import { util } from "./util";\nexport const run = util;',
      },
      { path: "src/util.ts", content: "export const util = () => 1;" },
    ];
    expect(repoOrder(files).map((f) => f.path)).toEqual([
      "src/util.ts",
      "src/app.ts",
      "src/main.ts",
    ]);
  });

  it("resolves CommonJS require and directory index files", () => {
    const files: RepoFile[] = [
      {
        path: "index.ts",
        content: 'const lib = require("./lib");\nexport default lib;',
      },
      { path: "lib/index.ts", content: "export const lib = 1;" },
    ];
    expect(repoOrder(files).map((f) => f.path)).toEqual([
      "lib/index.ts",
      "index.ts",
    ]);
  });

  it("resolves Python dotted imports", () => {
    const files: RepoFile[] = [
      { path: "main.py", content: "from pkg.core import run\nrun()" },
      { path: "pkg/core.py", content: "def run():\n    return 1" },
    ];
    expect(repoOrder(files).map((f) => f.path)).toEqual([
      "pkg/core.py",
      "main.py",
    ]);
  });

  it("breaks cycles with a stable fallback order and never fails", () => {
    const files: RepoFile[] = [
      { path: "a.ts", content: 'import "./b";' },
      { path: "b.ts", content: 'import "./a";' },
      { path: "c.ts", content: "export const c = 0;" },
    ];
    const ordered = repoOrder(files).map((f) => f.path);
    expect(ordered).toHaveLength(3);
    // c is acyclic and comes first (smallest zero-indegree index); the cyclic
    // pair a/b keeps its original relative order.
    expect(ordered[0]).toBe("c.ts");
    expect(ordered.indexOf("a.ts")).toBeLessThan(ordered.indexOf("b.ts"));
  });

  it("ignores external package imports", () => {
    const files: RepoFile[] = [
      { path: "a.ts", content: 'import fs from "node:fs";\nimport "./b";' },
      { path: "b.ts", content: "export const b = 1;" },
    ];
    expect(repoOrder(files).map((f) => f.path)).toEqual(["b.ts", "a.ts"]);
  });

  it("extractImportSpecifiers reads one specifier per import line", () => {
    const specifiers = extractImportSpecifiers(
      'import a from "./a";\nconst b = require("./b");\nfrom pkg.c import d',
    );
    expect(specifiers).toEqual(["./a", "./b", "pkg.c"]);
  });
});
