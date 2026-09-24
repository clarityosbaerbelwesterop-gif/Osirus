import { describe, expect, it } from "vitest";
import { classifyAuthority } from "../src/lib/research/authority";
import { renderResearchAnswer, verifyClaims } from "../src/lib/research/citations";
import {
  buildEvidenceLedger,
  synthesizeBrief,
  updateBeliefsUnderContradiction,
} from "../src/lib/research/evidence-ledger";
import { persistResearchNotes } from "../src/lib/research/memory-notes";
import { fallbackPlan } from "../src/lib/research/pipeline";
import {
  formatPulseMarkdown,
  RESEARCH_PULSE_TASKS,
  runResearchPulseSuite,
} from "../src/lib/research/pulse-suite";
import { researchPlanSchema } from "../src/lib/research/types";

function officialDoc() {
  return {
    id: "d1",
    url: "https://docs.example.org/quota",
    title: "Quota policy",
    publisher: "Example Docs",
    publishedAt: "2026-01-01T00:00:00Z",
    retrievedAt: "2026-09-22T00:00:00Z",
    contentHash: "d1",
    authority: classifyAuthority("https://docs.example.org/quota"),
    provider: "fixture",
    text: "The export quota is 500 units per calendar month for standard accounts.",
  };
}

describe("M36 research planning", () => {
  it("includes source strategy, information needs, and stop criteria", () => {
    const plan = fallbackPlan(
      "What is the current export quota for standard accounts?",
    );
    expect(plan.informationNeeds.length).toBeGreaterThan(0);
    expect(plan.sourceStrategy.official_docs).toBeTruthy();
    expect(plan.stop.requireCounterEvidence).toBe(true);
    expect(plan.stopCriteria?.minDocuments).toBe(4);
  });

  it("parses an enhanced plan schema", () => {
    const parsed = researchPlanSchema.parse({
      question: "Q",
      subquestions: ["Q"],
      freshness: "any",
      sourceClasses: ["primary"],
      sourceStrategy: { primary: "Find the statute." },
      informationNeeds: [{ need: "Exact quota number", priority: "required" }],
      queries: ["quota"],
      counterQueries: ["quota controversy"],
      stop: {
        minDocuments: 3,
        minIndependentPublishers: 2,
        requireCounterEvidence: true,
        minSupportedClaims: 1,
      },
    });
    expect(parsed.informationNeeds[0]?.need).toContain("quota");
    expect(parsed.stop.minSupportedClaims).toBe(1);
  });
});

describe("M36 evidence ledger", () => {
  it("links claims to sources, confidence, and contradictions", () => {
    const official = officialDoc();
    const news = {
      ...official,
      id: "d2",
      url: "https://news.example.com/quota",
      authority: classifyAuthority("https://news.example.com/quota"),
      text: "Analysts report the export quota rose to 750 units after the March revision.",
    };
    const verified = verifyClaims(
      {
        answer: "Disagreement.",
        brief: "",
        openQuestions: [],
        claims: [
          {
            statement: "The export quota is 500 units per calendar month.",
            kind: "fact",
            support: [
              {
                url: official.url,
                excerpt:
                  "The export quota is 500 units per calendar month for standard accounts.",
              },
            ],
            contradict: [
              {
                url: news.url,
                excerpt:
                  "Analysts report the export quota rose to 750 units after the March revision.",
              },
            ],
          },
        ],
      },
      [official, news],
      { freshness: "any" },
    );
    const ledger = buildEvidenceLedger({
      question: "What is the export quota?",
      plan: fallbackPlan("What is the export quota?"),
      synthesis: {
        answer: "Disagreement.",
        brief: "",
        openQuestions: ["What is the enterprise quota?"],
        claims: [
          {
            statement: "The export quota is 500 units per calendar month.",
            kind: "fact",
            support: [
              {
                url: official.url,
                excerpt:
                  "The export quota is 500 units per calendar month for standard accounts.",
              },
            ],
            contradict: [
              {
                url: news.url,
                excerpt:
                  "Analysts report the export quota rose to 750 units after the March revision.",
              },
            ],
          },
        ],
      },
      verified,
      documents: [official, news],
    });
    expect(ledger.claims[0]?.status).toBe("CONTESTED");
    expect(ledger.contradictions).toHaveLength(1);
    expect(ledger.contradictions[0]?.diagnosis).toBeTruthy();
    expect(ledger.openQuestions).toContain("What is the enterprise quota?");
    expect(ledger.brief.toLowerCase()).toContain("contested");
  });

  it("records belief updates when contradiction weakens a prior supported claim", () => {
    const prior = [
      {
        id: "claim-1",
        statement: "Quota is 500.",
        kind: "fact" as const,
        status: "SUPPORTED" as const,
        confidence: 0.9,
        supporting: [],
        contradicting: [],
        rejectedCitations: [],
      },
    ];
    const current = [
      {
        ...prior[0]!,
        status: "CONTESTED" as const,
        contradicting: [
          {
            documentId: "d2",
            url: "https://news.example.com",
            excerpt: "750 units",
            authority: "news" as const,
            publisher: "news.example.com",
          },
        ],
      },
    ];
    const updates = updateBeliefsUnderContradiction(current, prior);
    expect(updates).toHaveLength(1);
    expect(updates[0]?.newStatus).toBe("CONTESTED");
  });
});

describe("M36 synthesis rendering", () => {
  it("separates facts, contested claims, and unsupported statements", () => {
    const official = officialDoc();
    const claims = verifyClaims(
      {
        answer: "Mixed.",
        brief: "Brief.",
        openQuestions: [],
        claims: [
          {
            statement: "The export quota is 500 units per calendar month.",
            kind: "fact",
            support: [
              {
                url: official.url,
                excerpt:
                  "The export quota is 500 units per calendar month for standard accounts.",
              },
            ],
            contradict: [],
          },
          {
            statement: "Enterprise buyers have no quota.",
            kind: "inference",
            support: [],
            contradict: [],
          },
        ],
      },
      [official],
      { freshness: "any" },
    );
    const rendered = renderResearchAnswer("Summary.", claims, [official]);
    expect(rendered).toContain("### Facts");
    expect(rendered).toContain("### Unsupported");
  });

  it("builds an actionable brief from claim kinds", () => {
    const brief = synthesizeBrief({
      question: "Quota?",
      claims: [
        {
          id: "c1",
          statement: "Quota is 500.",
          kind: "fact",
          status: "SUPPORTED",
          confidence: 0.8,
          supporting: [],
          contradicting: [],
          rejectedCitations: [],
        },
        {
          id: "c2",
          statement: "Enterprise tier may be higher.",
          kind: "inference",
          status: "INSUFFICIENT",
          confidence: 0.4,
          supporting: [],
          contradicting: [],
          rejectedCitations: [],
        },
      ],
      openQuestions: ["What is the enterprise quota?"],
    });
    expect(brief).toMatch(/Established facts/i);
    expect(brief).toMatch(/Inferences/i);
    expect(brief).toMatch(/Open questions/i);
  });
});

describe("M36 memory integration", () => {
  it("writes episodic and semantic notes through the memory compiler interface", async () => {
    const stored: string[] = [];
    const memory = {
      compileAndStore: async (input: { kind: string; content: string }) => {
        stored.push(`${input.kind}:${input.content.slice(0, 40)}`);
        return { decision: "STORE", persistedId: `m-${stored.length}`, reason: "ok" };
      },
      latestBySubject: async () => [],
    };
    await persistResearchNotes({
      memory: memory as never,
      organizationId: "org",
      workspaceId: "ws",
      runId: "run",
      ledger: {
        question: "Quota?",
        brief: "Established facts:\n- Quota is 500.",
        openQuestions: ["Enterprise quota?"],
        beliefUpdates: [],
        contradictions: [],
        stopMet: true,
        claims: [
          {
            id: "c1",
            statement: "Quota is 500.",
            kind: "fact",
            status: "SUPPORTED",
            confidence: 0.9,
            supporting: [
              {
                documentId: "d1",
                url: "https://docs.example.org",
                excerpt: "500 units",
                authority: "official_docs",
                publisher: "docs.example.org",
              },
            ],
            contradicting: [],
            rejectedCitations: [],
          },
        ],
      },
    });
    expect(stored.some((entry) => entry.startsWith("run_summary:"))).toBe(true);
    expect(stored.some((entry) => entry.startsWith("evidence:"))).toBe(true);
  });
});

describe("M36 research pulse suite", () => {
  it("registers five offline tasks from L1 through L5", () => {
    expect(RESEARCH_PULSE_TASKS.map((task) => task.level)).toEqual([
      "L1",
      "L2",
      "L3",
      "L4",
      "L5",
    ]);
    expect(RESEARCH_PULSE_TASKS.filter((task) => task.adversarial).length).toBe(
      3,
    );
  });

  it("passes all research lane pulse tasks offline", async () => {
    const results = await runResearchPulseSuite();
    expect(results).toHaveLength(5);
    for (const result of results) {
      expect(result.passed, `${result.id}: ${result.notes}`).toBe(true);
    }
    const markdown = formatPulseMarkdown(results);
    expect(markdown).toContain("research-l3-contradiction");
    expect(markdown).not.toContain("| no |");
  });
});
