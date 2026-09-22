import type { ModelRole } from "../models/provider";
import type { Capability } from "../runtime/types";
import {
  secretLeakCheck,
  sourceCheck,
  structureCheck,
} from "../verification/checks";
import { BaseArm } from "./base";
import type { ArmId, ArmStageContext, RoutingInput } from "./types";

export type RetrievedDocument = {
  url: string;
  fetchedAt: string;
  bytes?: number;
};

const URL_PATTERN = /https?:\/\/[^\s<>()\[\]"']+/g;

export function extractCitations(answer: string): string[] {
  return [
    ...new Set(
      (answer.match(URL_PATTERN) ?? []).map((url) =>
        url.replace(/[.,;:]+$/, ""),
      ),
    ),
  ];
}

/**
 * Research answers are graded against what this run actually fetched.
 *
 * With no retrieval tool configured the retrieved set is empty, so any URL in
 * the answer is a citation the run cannot support and the source check fails.
 * That is the point: an unsourced answer comes back "unverified", and a
 * fabricated source comes back "rejected". Neither is reported as research.
 */
export class ResearchArm extends BaseArm {
  readonly id: ArmId = "research";

  canHandle(input: RoutingInput): number {
    const text = input.objective.toLowerCase();
    let score = 0;
    if (
      /\b(research|investigate|sources?|cite|citation|evidence|literature|survey|find out|who|when did|according to)\b/.test(
        text,
      )
    ) {
      score += 0.5;
    }
    if (/\b(latest|current|recent|today|news|2\d{3})\b/.test(text)) {
      score += 0.25;
    }
    if (/\bcompare\b|\bversus\b|\bvs\.?\b/.test(text)) score += 0.1;
    return Math.min(score, 1);
  }

  protected primaryCapability(): Capability {
    return "research";
  }

  protected modelRole(): ModelRole {
    return "RESEARCH";
  }

  protected additionalStages() {
    return [
      {
        key: "decompose",
        name: "Decompose the research question",
        kind: "understand",
      },
      { key: "gather", name: "Gather sources", kind: "gather" },
    ];
  }

  protected skillAffinity(): string[] {
    return ["research", "analysis", "sourcing"];
  }

  protected answerDirectives(): string[] {
    return [
      "Cite a source URL for every factual claim that is not common knowledge.",
      "Only cite documents supplied to you in this run's context.",
      "If no sources were supplied, say so and mark the answer as unsourced rather than inventing citations.",
      "Separate what the sources state from what you infer.",
    ];
  }

  protected async customStage(context: ArmStageContext) {
    if ((context.work.stageInput.stageKind as string) !== "gather") {
      return super.customStage(context);
    }
    // Retrieval tooling arrives with the tool registry. Until then this stage
    // records honestly that nothing was fetched, which is what the source
    // check grades against.
    const retrieved: RetrievedDocument[] = [];
    context.state.retrieved = retrieved;
    await context.runtime.activity("research.gathered", "Gathered sources", {
      count: retrieved.length,
      retrieval: "NOT_CONFIGURED",
    });
    return {
      kind: "COMPLETE" as const,
      output: { retrieved, retrieval: "NOT_CONFIGURED" },
    };
  }

  protected checksFor(context: ArmStageContext, answer: string) {
    const retrieved =
      (context.state.retrieved as RetrievedDocument[] | undefined) ?? [];
    const citations = extractCitations(answer);

    return [
      structureCheck({
        id: "answer-present",
        required: true,
        requiredFields: ["answer"],
        minLength: 40,
      }),
      sourceCheck({
        citations,
        retrieved,
        // With no retrieval configured, demanding a citation would make every
        // run fail rather than report honestly. Demanding that every citation
        // given be one this run fetched still holds, and is the check that
        // catches a fabricated source.
        minimumCitations: 0,
        required: true,
      }),
      {
        id: "sourcing-disclosed",
        type: "STRUCTURE" as const,
        required: false,
        run: () => {
          if (retrieved.length > 0) {
            return {
              status: "passed" as const,
              detail: `${retrieved.length} document(s) retrieved in this run.`,
              evidence: { retrieved },
            };
          }
          const discloses =
            /\b(unsourced|no sources|without sources|not retrieved|could not (?:access|fetch|browse)|no (?:internet|web) access)\b/i.test(
              answer,
            );
          return discloses
            ? {
                status: "passed" as const,
                detail:
                  "Answer discloses that it was produced without retrieved sources.",
                evidence: { retrieval: "NOT_CONFIGURED" },
              }
            : {
                status: "failed" as const,
                detail:
                  "No sources were retrieved and the answer does not disclose that.",
                evidence: { retrieval: "NOT_CONFIGURED" },
              };
        },
      },
      secretLeakCheck(),
    ];
  }
}
