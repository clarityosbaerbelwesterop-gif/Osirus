import { describe, expect, it } from "vitest";
import {
  arbitrate,
  VerificationEngine,
  type CheckResult,
  type CheckType,
} from "../src/lib/verification/engine";
import { checkArithmetic } from "../src/lib/arms/math-science";
import { extractCitations } from "../src/lib/arms/research";
import { extractCodeBlocks } from "../src/lib/arms/coding";
import {
  commandCheck,
  mathCheck,
  secretLeakCheck,
  sourceCheck,
  structureCheck,
} from "../src/lib/verification/checks";

function result(
  type: CheckType,
  status: CheckResult["status"],
  required = false,
  id = `${type}:${status}`,
): CheckResult {
  return {
    id,
    type,
    required,
    status,
    detail: "",
    evidence: {},
    durationMs: 0,
  };
}

describe("verification arbitration", () => {
  it("never lets model review alone produce a verified verdict", () => {
    // The rule this whole engine exists for. The runtime previously called
    // `assistant.trim().length > 0` verification; a unanimous panel of model
    // reviewers is a better signal than that and still is not evidence.
    const verdict = arbitrate([
      result("MODEL", "passed"),
      result("MODEL", "passed", false, "second-reviewer"),
      result("MODEL", "passed", false, "third-reviewer"),
    ]);
    expect(verdict.status).toBe("unverified");
    expect(verdict.summary).toMatch(/deterministic/i);
  });

  it("verifies when deterministic evidence passes", () => {
    expect(
      arbitrate([result("TEST", "passed", true), result("MODEL", "passed")])
        .status,
    ).toBe("verified");
  });

  it("calls a deterministic pass with model dissent conflicted", () => {
    const verdict = arbitrate([
      result("BUILD", "passed", true),
      result("MODEL", "failed"),
    ]);
    expect(verdict.status).toBe("conflicted");
  });

  it("rejects on a failing deterministic check even when nobody required it", () => {
    // A failing test observed something real. Leaving `required` off is a
    // statement about whether the check had to run, not about whether its
    // failure counts.
    expect(arbitrate([result("TEST", "failed")]).status).toBe("rejected");
  });

  it("rejects on a failing required check before anything else is weighed", () => {
    expect(
      arbitrate([result("STRUCTURE", "failed", true), result("TEST", "passed")])
        .status,
    ).toBe("rejected");
  });

  it("treats an inconclusive required check as no evidence, not agreement", () => {
    expect(
      arbitrate([
        result("TEST", "inconclusive", true),
        result("MODEL", "passed"),
      ]).status,
    ).toBe("unverified");
  });

  it("returns unverified when no checks ran at all", () => {
    expect(arbitrate([]).status).toBe("unverified");
  });

  it("records a throwing check as inconclusive rather than passing it", async () => {
    const engine = new VerificationEngine([
      {
        id: "explodes",
        type: "TOOL",
        required: true,
        run() {
          throw new Error("connection reset");
        },
      },
    ]);
    const verdict = await engine.run({
      runId: "r",
      stageId: "s",
      objective: "o",
      output: {},
    });
    expect(verdict.checks[0]?.status).toBe("inconclusive");
    expect(verdict.status).toBe("unverified");
  });

  it("redacts credential-shaped strings out of the evidence it stores", async () => {
    const engine = new VerificationEngine([
      {
        id: "leaky",
        type: "TOOL",
        run: () => ({
          status: "passed" as const,
          detail: "connected to postgresql://user:pw@host/db",
          evidence: { url: "postgresql://user:pw@host/db" },
        }),
      },
    ]);
    const verdict = await engine.run({
      runId: "r",
      stageId: "s",
      objective: "o",
      output: {},
    });
    expect(verdict.checks[0]?.detail).toContain("[REDACTED]");
    expect(JSON.stringify(verdict.checks[0]?.evidence)).not.toContain(
      "pw@host",
    );
  });
});

describe("check library", () => {
  const context = {
    runId: "r",
    stageId: "s",
    objective: "o",
    output: { answer: "hello world, this is a complete answer." },
  };

  it("fails a structure check that is missing a promised field", async () => {
    const check = structureCheck({ requiredFields: ["answer", "citations"] });
    expect((await check.run(context)).status).toBe("failed");
  });

  it("fails a citation this run never retrieved", async () => {
    const check = sourceCheck({
      citations: ["https://example.com/a", "https://invented.example/b"],
      retrieved: [
        { url: "https://example.com/a", fetchedAt: "2026-01-01T00:00:00Z" },
      ],
    });
    const outcome = await check.run(context);
    expect(outcome.status).toBe("failed");
    expect(outcome.detail).toContain("invented.example");
  });

  it("reports a command that never ran as inconclusive, not as passing", async () => {
    const check = commandCheck({ id: "tests", type: "TEST", result: null });
    expect((await check.run(context)).status).toBe("inconclusive");
  });

  it("keeps model review out of the MATH type", () => {
    // A derivation a model agreed with has not been checked. mathCheck only
    // accepts methods that compute, so there is no way to record a review as
    // a mathematical verification.
    const check = mathCheck({ method: "numeric", agrees: true });
    expect(check.type).toBe("MATH");
    expect(() =>
      mathCheck({
        // @ts-expect-error model review is deliberately not a math method
        method: "model_review",
        agrees: true,
      }),
    ).not.toThrow();
  });

  it("blocks an answer carrying a credential", async () => {
    const check = secretLeakCheck();
    const outcome = await check.run({
      ...context,
      output: { answer: "use sk-abcdefghijklmnopqrstuvwxyz to connect" },
    });
    expect(outcome.status).toBe("failed");
    expect(JSON.stringify(outcome.evidence)).not.toContain("abcdefghij");
  });
});

describe("arm evidence extraction", () => {
  it("recomputes arithmetic the answer asserts", () => {
    const claims = checkArithmetic("We get 12 * 12 = 144 and then 7 + 5 = 13.");
    expect(claims).toHaveLength(2);
    expect(claims[0]?.agrees).toBe(true);
    expect(claims[1]?.agrees).toBe(false);
    expect(claims[1]?.expected).toBe(12);
  });

  it("finds citations without swallowing trailing punctuation", () => {
    expect(
      extractCitations("See https://example.com/page, and https://a.test/x."),
    ).toEqual(["https://example.com/page", "https://a.test/x"]);
  });

  it("extracts fenced code blocks with their language tag", () => {
    const blocks = extractCodeBlocks(
      "Here:\n```ts\nconst a = 1;\n```\nand\n```json\n{}\n```\n",
    );
    expect(blocks.map((block) => block.language)).toEqual(["ts", "json"]);
  });
});
