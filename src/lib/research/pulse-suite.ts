import { classifyAuthority } from "./authority";
import { checkCitation, coverage, verifyClaims } from "./citations";
import {
  buildEvidenceLedger,
  synthesizeBrief,
  updateBeliefsUnderContradiction,
} from "./evidence-ledger";
import { fallbackPlan } from "./pipeline";
import { MemoryEvidenceStore } from "./store";
import type {
  ResearchDocument,
  ResearchPulseLevel,
  ResearchPulseResult,
  ResearchPulseTask,
} from "./types";

// Research lane pulse tasks (L1–L5).
//
// M34 hourly pulse is deferred. These are typed, offline-graded tasks that
// register the Research capability ladder without a second scheduler.

function doc(
  overrides: Partial<ResearchDocument> & {
    id: string;
    url: string;
    text: string;
  },
): ResearchDocument {
  return {
    title: "fixture",
    publisher: null,
    publishedAt: null,
    retrievedAt: "2026-09-22T00:00:00Z",
    contentHash: overrides.id,
    authority: classifyAuthority(overrides.url),
    provider: "fixture",
    ...overrides,
  };
}

const OFFICIAL = doc({
  id: "official",
  url: "https://docs.example.org/policy",
  text: "The export quota is 500 units per calendar month for standard accounts.",
});
const NEWS = doc({
  id: "news",
  url: "https://news.example.com/quota",
  text: "Analysts report the export quota rose to 750 units after the March revision.",
  publishedAt: "2026-03-01T00:00:00Z",
});
const ARCHIVE = doc({
  id: "archive",
  url: "https://archive.example.org/quota-2019",
  text: "The export quota was 300 units per month in 2019.",
  publishedAt: "2019-06-01T00:00:00Z",
});

export const RESEARCH_PULSE_TASKS: ResearchPulseTask[] = [
  {
    id: "research-l1-citation",
    level: "L1",
    title: "Accept a verbatim citation from a retrieved document",
    objective: "Verify one claim against one fixture document.",
    adversarial: false,
  },
  {
    id: "research-l2-corroboration",
    level: "L2",
    title:
      "Require two independent publishers before treating coverage as sufficient",
    objective: "Coverage stop rule with two publishers.",
    adversarial: false,
  },
  {
    id: "research-l3-contradiction",
    level: "L3",
    title: "Keep contradictory sources visible instead of picking a winner",
    objective: "Adversarial contradiction handling.",
    adversarial: true,
  },
  {
    id: "research-l4-stale-belief",
    level: "L4",
    title: "Weaken beliefs when only stale sources support a current question",
    objective: "Belief update under stale evidence.",
    adversarial: true,
  },
  {
    id: "research-l5-ledger-brief",
    level: "L5",
    title:
      "Produce an actionable brief that separates fact, inference, and open questions",
    objective: "Full evidence ledger and brief synthesis.",
    adversarial: true,
  },
];

export async function runResearchPulseTask(
  task: ResearchPulseTask,
): Promise<ResearchPulseResult> {
  const started = Date.now();
  switch (task.id) {
    case "research-l1-citation": {
      const check = checkCitation(
        "The export quota is 500 units per calendar month.",
        {
          url: OFFICIAL.url,
          excerpt:
            "The export quota is 500 units per calendar month for standard accounts.",
        },
        [OFFICIAL],
      );
      const passed = check.ok === true;
      return {
        ...task,
        passed,
        notes: passed
          ? "Verbatim excerpt accepted."
          : `Citation check failed: ${JSON.stringify(check)}`,
        latencyMs: Date.now() - started,
      };
    }
    case "research-l2-corroboration": {
      const store = new MemoryEvidenceStore();
      await store.addDocument({ ...OFFICIAL });
      await store.addDocument({ ...NEWS });
      const documents = await store.documents();
      const claims = verifyClaims(
        {
          answer: "Quota changed.",
          brief: "",
          openQuestions: [],
          claims: [
            {
              statement: "The export quota is 500 units per calendar month.",
              kind: "fact",
              support: [
                {
                  url: OFFICIAL.url,
                  excerpt:
                    "The export quota is 500 units per calendar month for standard accounts.",
                },
              ],
              contradict: [],
            },
          ],
        },
        documents,
        { freshness: "any" },
      );
      const plan = fallbackPlan("What is the export quota?");
      plan.stop.minDocuments = 2;
      if (plan.stopCriteria) plan.stopCriteria.minDocuments = 2;
      const report = coverage(claims, documents, plan);
      const passed =
        report.publishers >= 2 &&
        report.meetsStopRule &&
        claims[0]?.status === "SUPPORTED";
      return {
        ...task,
        passed,
        notes: `publishers=${report.publishers}, meetsStop=${report.meetsStopRule}`,
        latencyMs: Date.now() - started,
      };
    }
    case "research-l3-contradiction": {
      const claims = verifyClaims(
        {
          answer: "Sources disagree.",
          brief: "",
          openQuestions: ["What is the current export quota?"],
          claims: [
            {
              statement: "The export quota is 500 units per calendar month.",
              kind: "fact",
              support: [
                {
                  url: OFFICIAL.url,
                  excerpt:
                    "The export quota is 500 units per calendar month for standard accounts.",
                },
              ],
              contradict: [
                {
                  url: NEWS.url,
                  excerpt:
                    "Analysts report the export quota rose to 750 units after the March revision.",
                },
              ],
            },
          ],
        },
        [OFFICIAL, NEWS],
        { freshness: "any" },
      );
      const ledger = buildEvidenceLedger({
        question: "What is the export quota?",
        plan: fallbackPlan("What is the export quota?"),
        synthesis: {
          answer: "Sources disagree on the quota.",
          brief: "",
          openQuestions: ["What is the current export quota?"],
          claims: [
            {
              statement: "The export quota is 500 units per calendar month.",
              kind: "fact",
              support: [
                {
                  url: OFFICIAL.url,
                  excerpt:
                    "The export quota is 500 units per calendar month for standard accounts.",
                },
              ],
              contradict: [
                {
                  url: NEWS.url,
                  excerpt:
                    "Analysts report the export quota rose to 750 units after the March revision.",
                },
              ],
            },
          ],
        },
        verified: claims,
        documents: [OFFICIAL, NEWS],
      });
      const brief = ledger.brief.toLowerCase();
      const passed =
        claims[0]?.status === "CONTESTED" &&
        ledger.contradictions.length === 1 &&
        brief.includes("contested") &&
        !brief.includes("750 units per calendar month for standard accounts");
      return {
        ...task,
        passed,
        notes: `status=${claims[0]?.status}, contradictions=${ledger.contradictions.length}`,
        latencyMs: Date.now() - started,
      };
    }
    case "research-l4-stale-belief": {
      const claims = verifyClaims(
        {
          answer: "Possibly outdated.",
          brief: "",
          openQuestions: [],
          claims: [
            {
              statement: "The export quota was 300 units per month.",
              kind: "fact",
              support: [
                {
                  url: ARCHIVE.url,
                  excerpt: "The export quota was 300 units per month in 2019.",
                },
              ],
              contradict: [],
            },
          ],
        },
        [ARCHIVE],
        { freshness: "current", now: Date.parse("2026-09-22T00:00:00Z") },
      );
      const prior = [
        {
          id: "claim-1",
          statement: "The export quota was 300 units per month.",
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
          status: claims[0]!.status,
          confidence: claims[0]!.confidence,
        },
      ];
      const updates = updateBeliefsUnderContradiction(current, prior);
      const passed = claims[0]?.status === "STALE" && updates.length === 1;
      return {
        ...task,
        passed,
        notes: `status=${claims[0]?.status}, beliefUpdates=${updates.length}`,
        latencyMs: Date.now() - started,
      };
    }
    case "research-l5-ledger-brief": {
      const claims = verifyClaims(
        {
          answer: "Mixed evidence.",
          brief: "",
          openQuestions: ["What is the enterprise quota after March?"],
          claims: [
            {
              statement: "The export quota is 500 units per calendar month.",
              kind: "fact",
              support: [
                {
                  url: OFFICIAL.url,
                  excerpt:
                    "The export quota is 500 units per calendar month for standard accounts.",
                },
              ],
              contradict: [],
            },
            {
              statement:
                "The quota likely increased for enterprise buyers after the March revision.",
              kind: "inference",
              support: [],
              contradict: [],
            },
            {
              statement: "What is the enterprise quota after March?",
              kind: "open_question",
              support: [],
              contradict: [],
            },
          ],
        },
        [OFFICIAL, NEWS],
        { freshness: "any" },
      );
      const ledger = buildEvidenceLedger({
        question: "What is the export quota?",
        plan: fallbackPlan("What is the export quota?"),
        synthesis: {
          answer: "Official docs say 500; news hints at a higher tier.",
          brief: "",
          openQuestions: ["What is the enterprise quota after March?"],
          claims: [
            {
              statement: "The export quota is 500 units per calendar month.",
              kind: "fact",
              support: [
                {
                  url: OFFICIAL.url,
                  excerpt:
                    "The export quota is 500 units per calendar month for standard accounts.",
                },
              ],
              contradict: [],
            },
            {
              statement:
                "The quota likely increased for enterprise buyers after the March revision.",
              kind: "inference",
              support: [],
              contradict: [],
            },
            {
              statement: "What is the enterprise quota after March?",
              kind: "open_question",
              support: [],
              contradict: [],
            },
          ],
        },
        verified: claims,
        documents: [OFFICIAL, NEWS],
      });
      const brief = synthesizeBrief({
        question: ledger.question,
        claims: ledger.claims,
        openQuestions: ledger.openQuestions,
      });
      const passed =
        ledger.claims.some((claim) => claim.kind === "fact") &&
        ledger.claims.some((claim) => claim.kind === "inference") &&
        ledger.openQuestions.length > 0 &&
        /established facts/i.test(brief) &&
        /inferences/i.test(brief) &&
        /open questions/i.test(brief);
      return {
        ...task,
        passed,
        notes: `claims=${ledger.claims.length}, openQuestions=${ledger.openQuestions.length}`,
        latencyMs: Date.now() - started,
      };
    }
    default:
      return {
        ...task,
        passed: false,
        notes: "Unknown pulse task.",
        latencyMs: Date.now() - started,
      };
  }
}

export async function runResearchPulseSuite(
  levels?: ResearchPulseLevel[],
): Promise<ResearchPulseResult[]> {
  const selected = levels
    ? RESEARCH_PULSE_TASKS.filter((task) => levels.includes(task.level))
    : RESEARCH_PULSE_TASKS;
  return Promise.all(selected.map((task) => runResearchPulseTask(task)));
}

export function formatPulseMarkdown(results: ResearchPulseResult[]) {
  const lines = [
    "# M36 Research pulse suite (offline)",
    "",
    "| Level | Task | Pass | Notes |",
    "| --- | --- | --- | --- |",
  ];
  for (const result of results) {
    lines.push(
      `| ${result.level} | ${result.id} | ${result.passed ? "yes" : "no"} | ${result.notes.replace(/\|/g, "/")} |`,
    );
  }
  return lines.join("\n");
}
