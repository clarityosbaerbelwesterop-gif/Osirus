import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  answerSegment,
  dateIn,
  FAMILIES,
  generateBenchmark,
  numberIn,
  pyDiv,
  pyMod,
} from "../evals/rouge/m57-benchmark";
import { mcnemarExact, paired } from "../evals/rouge/stats";

// The M57 capability benchmark: generated tasks, computed answers, and the
// paired statistics the gate is decided on.

describe("M57 benchmark generation", () => {
  it("is reproducible from its seed and different across seeds", () => {
    const a = generateBenchmark("seed-a", 2);
    expect(generateBenchmark("seed-a", 2).map((t) => t.prompt)).toEqual(
      a.map((t) => t.prompt),
    );
    const b = generateBenchmark("seed-b", 2);
    const overlap = a.filter((t) => b.some((u) => u.prompt === t.prompt));
    expect(overlap).toHaveLength(0);
    expect(new Set(a.map((t) => t.family))).toEqual(new Set(FAMILIES));
  });

  it("does not depend on how many tasks are drawn", () => {
    const three = generateBenchmark("s", 3).filter((t) => t.id.endsWith("-2"));
    const six = generateBenchmark("s", 6).filter((t) => t.id.endsWith("-2"));
    expect(six.map((t) => t.prompt)).toEqual(three.map((t) => t.prompt));
  });

  it("checks every task against its computed answer, leniently and identically for all", () => {
    for (const task of generateBenchmark("check", 4)) {
      expect(task.check(`Working...\nAnswer: ${task.expected}`), task.id).toBe(
        "correct",
      );
      expect(task.check(`**Answer:** ${task.expected}.`), task.id).toBe(
        "correct",
      );
      expect(task.check(""), task.id).toBe("no_answer");
    }
  });

  it("rejects a wrong answer in every family", () => {
    const wrong: Record<string, string> = {
      arithmetic: "1",
      "date-offset": "1900-01-01",
      weekday: "Funday",
      "letter-count": "99999",
      modpow: "99999",
      "base-conversion": "9",
      knights: "Nobody",
      ordering: "Zed",
      trace: "123456789",
      "list-ops": "99999",
    };
    for (const task of generateBenchmark("wrong", 2)) {
      const verdict = task.check(`Answer: ${wrong[task.family]}`);
      expect(verdict === "wrong" || verdict === "no_answer", task.id).toBe(
        true,
      );
    }
    const knights = generateBenchmark("wrong", 1).find(
      (t) => t.family === "knights",
    )!;
    expect(knights.check("Answer: Ava, Ben, Cleo, Dev, Eli")).toBe("wrong");
  });

  it("reads answers the way people write them", () => {
    expect(answerSegment("blah\nAnswer: 42")).toBe("42");
    expect(answerSegment("x\n\nThe result is 7")).toBe("The result is 7");
    expect(numberIn("1,234,567")).toBe(1234567);
    expect(numberIn("2^10 = 1024")).toBe(1024);
    expect(numberIn("-37")).toBe(-37);
    expect(numberIn("none")).toBeNull();
    expect(dateIn("2031-03-05")).toBe("2031-03-05");
    expect(dateIn("5 March 2031")).toBe("2031-03-05");
    expect(dateIn("March 5, 2031")).toBe("2031-03-05");
  });

  it("traces programs with Python's floor division and modulo", () => {
    expect(pyMod(-7, 3)).toBe(2);
    expect(pyDiv(-7, 2)).toBe(-4);
    // Pinned against CPython 3 (verified when the generator was written).
    const trace = generateBenchmark("show", 1).find(
      (t) => t.family === "trace",
    )!;
    expect(trace.prompt).toContain("x = -13");
    expect(trace.expected).toBe("344");
  });

  it("stays out of Rouge: nothing in src/ imports the benchmark", () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.(ts|tsx)$/.test(name)) files.push(path);
      }
    };
    walk(join(__dirname, "../src"));
    // Rouge imports nothing from any evals directory; nothing in src/
    // imports Rouge's benchmarks or task sets.
    const leaking = files.filter((file) => {
      const source = readFileSync(file, "utf8");
      const imports = [
        ...source.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g),
      ].map((match) => match[1]!);
      return imports.some(
        (path) =>
          /m57-benchmark|core-selection-tasks|kernel-holdout-tasks|evals\/rouge/.test(
            path,
          ) ||
          (file.includes(join("lib", "rouge")) && /(^|\/)evals\//.test(path)),
      );
    });
    expect(leaking).toEqual([]);
  });
});

describe("paired statistics", () => {
  it("computes McNemar's exact test", () => {
    expect(mcnemarExact(0, 0)).toBe(1);
    expect(mcnemarExact(10, 2)).toBeCloseTo(0.0386, 3);
    expect(mcnemarExact(2, 10)).toBeCloseTo(0.0386, 3);
    expect(mcnemarExact(5, 5)).toBe(1);
  });

  it("puts a bootstrap interval around the paired difference", () => {
    const a = Array.from({ length: 60 }, (_, i) => i % 4 !== 0); // 45/60
    const b = Array.from({ length: 60 }, (_, i) => i % 2 === 0); // 30/60
    const result = paired(a, b, { seed: "t" });
    expect(result.diff).toBeCloseTo(0.25);
    expect(result.ci95[0]).toBeGreaterThan(0);
    expect(result.ci95[0]).toBeLessThan(result.diff);
    expect(result.ci95[1]).toBeGreaterThan(result.diff);
    expect(result.pValue).toBeLessThan(0.05);
    const same = paired(a, a);
    expect(same).toMatchObject({ diff: 0, aOnly: 0, bOnly: 0, pValue: 1 });
  });
});
