import { describe, expect, it } from "vitest";
import {
  branchPinnedRows,
  coversTargets,
  FREE_POOL_SENTINEL,
  hasAnyValue,
  MODEL_ROLE_KEYS,
  optionalSecret,
  parseModelPolicy,
  rankFreeModels,
  resolveRoleModel,
  staleTargets,
  UNOROUTER_KEY_NAMES,
  parseTargetList,
  uncoveredTargets,
  type VercelEnvironmentRow,
} from "../scripts/lib/vercel-env.mjs";
import {
  keyDifferences,
  pickUsage,
  renderMarkdown,
  looksLikeChallenge,
  type KeyResult,
} from "../scripts/lib/provider-diagnostics.mjs";

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

describe("free-model-first runtime policy (M49)", () => {
  const listed = new Set(["grok-4.6", "a:free", "b:free"]);

  it("rewrites every role to the verified free pool by default", () => {
    expect(
      resolveRoleModel({
        requested: "",
        policy: "free-first",
        listedIds: listed,
      }),
    ).toBe(FREE_POOL_SENTINEL);
    expect(
      resolveRoleModel({
        requested: undefined,
        policy: "free-first",
        listedIds: listed,
      }),
    ).toBe("free");
    expect(MODEL_ROLE_KEYS).toEqual([
      "OSIRUS_MODEL_FAST",
      "OSIRUS_MODEL_STRONG",
      "OSIRUS_MODEL_THINKING",
      "OSIRUS_MODEL_CODING",
      "OSIRUS_MODEL_RESEARCH",
      "OSIRUS_MODEL_MATH",
      "OSIRUS_MODEL_VERIFY",
    ]);
  });

  it("never requires Grok or paid credit, and never accepts an unlisted ID", () => {
    // The legacy workflow default is ignored under free-first, never synced
    // and never fatal -- even when the paid model is not listed at all.
    expect(
      resolveRoleModel({
        requested: "grok-4.6",
        policy: "free-first",
        listedIds: listed,
      }),
    ).toBe("free");
    expect(
      resolveRoleModel({
        requested: "grok-4.6",
        policy: "free-first",
        listedIds: new Set(),
      }),
    ).toBe("free");
    expect(
      resolveRoleModel({
        requested: "grok-4.6",
        policy: "configured-first",
        listedIds: listed,
      }),
    ).toBe("grok-4.6");
    expect(
      resolveRoleModel({
        requested: "a:free",
        policy: "free-first",
        listedIds: listed,
      }),
    ).toBe("a:free");
    expect(() =>
      resolveRoleModel({
        requested: "invented:free",
        policy: "free-first",
        listedIds: listed,
      }),
    ).toThrow(/not listed/);
    expect(parseModelPolicy(undefined)).toBe("free-first");
    expect(() => parseModelPolicy("grok")).toThrow();
  });

  it("ranks only listed free chat models for the tier hints", () => {
    const catalog = {
      data: [
        {
          model_name: "b:free",
          is_free: true,
          supported_endpoint_types: ["openai"],
          metadata: JSON.stringify({ supportsTools: true, contextWindow: 9 }),
        },
        {
          model_name: "e:free",
          is_free: true,
          metadata: JSON.stringify({ mode: "embedding" }),
        },
        { model_name: "z:free", is_free: true, metadata: "{}" },
      ],
    };
    expect(
      rankFreeModels(["grok-4.6", "a:free", "b:free", "e:free"], catalog, [
        "a:free",
      ]),
    ).toEqual(["a:free", "b:free"]);
  });

  it("syncs all three keys and proves each target was rewritten", () => {
    expect(UNOROUTER_KEY_NAMES).toEqual([
      "UNOROUTER_API_KEY_1",
      "UNOROUTER_API_KEY_2",
      "UNOROUTER_API_KEY_3",
    ]);
    const rows: VercelEnvironmentRow[] = [
      { key: "OSIRUS_MODEL_STRONG", target: ["production"], updatedAt: 500 },
      { key: "OSIRUS_MODEL_STRONG", target: ["preview"], updatedAt: 2000 },
      {
        key: "OSIRUS_MODEL_STRONG",
        target: ["preview"],
        gitBranch: "feature-x",
        updatedAt: 100,
      },
    ];
    expect(
      staleTargets(
        rows,
        "OSIRUS_MODEL_STRONG",
        ["preview", "production"],
        1000,
      ),
    ).toEqual(["production"]);
    expect(branchPinnedRows(rows, "OSIRUS_MODEL_STRONG")).toEqual([
      "feature-x",
    ]);
  });
});

describe("provider diagnostics output (allowed fields only)", () => {
  it("keeps only numeric/boolean usage fields and never free text", () => {
    const usage = pickUsage({
      code: true,
      data: {
        name: "my token name",
        key: "sk-should-never-appear",
        total_granted: 100,
        total_used: 40,
        total_available: 60,
        unlimited_quota: false,
        model_limits_enabled: true,
        model_limits: { "a:free": true },
        expires_at: 0,
      },
    });
    expect(usage).toEqual({
      total_granted: 100,
      total_used: 40,
      total_available: 60,
      unlimited_quota: false,
      model_limits_enabled: true,
      expires_at: 0,
    });
    expect(JSON.stringify(usage)).not.toMatch(/sk-|token name/);
  });

  it("reports free-model differences between keys and renders no secret", () => {
    const key = (label: string, free: string[]): KeyResult => ({
      label,
      usage: { status: 200, ...pickUsage({ total_available: 1 }) },
      models: {
        status: 200,
        count: 10,
        freeCount: free.length,
        freeModelIds: free,
      },
    });
    const results = [
      key("KEY_1", ["a:free", "b:free"]),
      key("KEY_2", ["a:free"]),
      key("KEY_3", ["a:free", "b:free"]),
    ];
    const differences = keyDifferences(results);
    expect(differences).toEqual([{ model: "b:free", missingFrom: ["KEY_2"] }]);
    const markdown = renderMarkdown({
      runAt: "now",
      keys: results,
      differences,
    });
    expect(markdown).toContain("| KEY_2 |");
    expect(markdown).not.toMatch(/Bearer|Authorization|sk-/);
    expect(looksLikeChallenge("text/html", "")).toBe(true);
    expect(looksLikeChallenge("application/json", "{}")).toBe(false);
  });
});

describe("optional secret reading", () => {
  it("treats a configured-but-blank secret as absent", () => {
    // Regression: a GitHub secret that exists with an empty value arrives as
    // "". That is falsy but not nullish, so `?? generated` does not fall back
    // past it. The cookie secret was then set to "", which is itself falsy, so
    // it was dropped from the sync entirely and the run reported success while
    // leaving the deployment with auth unconfigured.
    expect(optionalSecret("")).toBeUndefined();
    expect(optionalSecret("   ")).toBeUndefined();
    expect(optionalSecret(undefined)).toBeUndefined();
    expect(optionalSecret(" value ")).toBe("value");
  });

  it("lets a generated fallback take over from a blank secret", () => {
    const generated = "generated-secret";
    expect(optionalSecret("") ?? generated).toBe(generated);
    expect(optionalSecret("supplied") ?? generated).toBe("supplied");
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
