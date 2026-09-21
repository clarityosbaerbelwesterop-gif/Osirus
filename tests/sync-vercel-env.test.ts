import { describe, expect, it } from "vitest";
import {
  coversTargets,
  hasAnyValue,
  isAllowedPrimaryModel,
  parseTargetList,
  uncoveredTargets,
  type VercelEnvironmentRow,
} from "../scripts/lib/vercel-env.mjs";

// Mirrors the shape the Vercel API actually returns for the Osirus project:
// one row per target, with preview rows pinned to a single git branch by the
// Neon integration.
const osirusProjectEnvironments: VercelEnvironmentRow[] = [
  {
    key: "DATABASE_URL",
    target: ["preview"],
    gitBranch: "build/m1-m5-production-gate",
  },
  {
    key: "DATABASE_URL",
    target: ["preview"],
    gitBranch: "build/m1-m5-osirus-foundation",
  },
  { key: "DATABASE_URL", target: ["development"], gitBranch: null },
  { key: "DATABASE_URL", target: ["production"], gitBranch: null },
];

describe("vercel environment coverage", () => {
  it("counts separate per-target rows as covering every target", () => {
    // Regression: the previous implementation asked whether a *single* row
    // covered *every* target. Vercel never stores it that way, so a fully
    // configured project reported as missing and the sync aborted.
    const environments: VercelEnvironmentRow[] = [
      { key: "DATABASE_URL", target: ["preview"] },
      { key: "DATABASE_URL", target: ["production"] },
    ];
    expect(
      coversTargets(environments, "DATABASE_URL", ["preview", "production"]),
    ).toBe(true);
  });

  it("accepts a bare string target as well as an array", () => {
    const environments: VercelEnvironmentRow[] = [
      { key: "NEON_AUTH_BASE_URL", target: "production" },
    ];
    expect(
      coversTargets(environments, "NEON_AUTH_BASE_URL", ["production"]),
    ).toBe(true);
  });

  it("covers production from the real Osirus project rows", () => {
    expect(
      coversTargets(osirusProjectEnvironments, "DATABASE_URL", ["production"]),
    ).toBe(true);
  });

  it("treats a branch-scoped preview row as covering only that branch", () => {
    expect(
      coversTargets(
        osirusProjectEnvironments,
        "DATABASE_URL",
        ["preview", "production"],
        "build/m1-m5-production-gate",
      ),
    ).toBe(true);
    expect(
      coversTargets(
        osirusProjectEnvironments,
        "DATABASE_URL",
        ["preview", "production"],
        "some-other-branch",
      ),
    ).toBe(false);
  });

  it("reports exactly which targets are uncovered", () => {
    expect(
      uncoveredTargets(osirusProjectEnvironments, "DATABASE_URL", [
        "preview",
        "production",
      ]),
    ).toEqual(["preview"]);
    expect(
      uncoveredTargets(osirusProjectEnvironments, "UNOROUTER_API_KEY_1", [
        "preview",
        "production",
      ]),
    ).toEqual(["preview", "production"]);
  });

  it("never counts a different key as coverage", () => {
    expect(
      coversTargets(osirusProjectEnvironments, "NEON_AUTH_COOKIE_SECRET", [
        "production",
      ]),
    ).toBe(false);
    expect(hasAnyValue(osirusProjectEnvironments, "DATABASE_URL")).toBe(true);
    expect(
      hasAnyValue(osirusProjectEnvironments, "NEON_AUTH_COOKIE_SECRET"),
    ).toBe(false);
  });
});

describe("primary model policy", () => {
  it("allows Grok 4.6 and explicit Opus 5 identifiers", () => {
    expect(isAllowedPrimaryModel("grok-4.6")).toBe(true);
    expect(isAllowedPrimaryModel("anthropic/claude-opus-5")).toBe(true);
  });

  it("rejects invented or unrelated model identifiers", () => {
    expect(isAllowedPrimaryModel("opus")).toBe(false);
    expect(isAllowedPrimaryModel("grok-5")).toBe(false);
    expect(isAllowedPrimaryModel("gpt-5")).toBe(false);
  });
});

describe("target list parsing", () => {
  it("defaults to both targets and rejects anything else", () => {
    expect(parseTargetList(undefined)).toEqual(["preview", "production"]);
    expect(parseTargetList("production")).toEqual(["production"]);
    expect(parseTargetList("preview")).toEqual(["preview"]);
    expect(() => parseTargetList("staging")).toThrow(/preview, production/);
  });
});
