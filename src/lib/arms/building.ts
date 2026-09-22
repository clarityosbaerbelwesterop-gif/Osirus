import type { ModelRole } from "../models/provider";
import type { Capability } from "../runtime/types";
import { secretLeakCheck, structureCheck } from "../verification/checks";
import { BaseArm } from "./base";
import type { ArmId, ArmStageContext, RoutingInput } from "./types";

/**
 * Multi-part deliverables: a document, a plan, a specification, a structured
 * artifact the user takes away. Distinguished from the coding arm by what it
 * produces (prose and structure) and from the general arm by having a declared
 * shape to meet.
 */
export class BuildingArm extends BaseArm {
  readonly id: ArmId = "building";

  canHandle(input: RoutingInput): number {
    const text = input.objective.toLowerCase();
    let score = 0;
    if (
      /\b(write|draft|produce|create|build|design|outline|prepare|generate)\b/.test(
        text,
      )
    ) {
      score += 0.35;
    }
    if (
      /\b(document|report|spec|specification|proposal|plan|deck|readme|guide|checklist|template|policy|memo)\b/.test(
        text,
      )
    ) {
      score += 0.4;
    }
    if (/\b(section|chapter|structure|format)\b/.test(text)) score += 0.1;
    return Math.min(score, 1);
  }

  protected primaryCapability(): Capability {
    return "general";
  }

  protected modelRole(): ModelRole {
    return "STRONG";
  }

  protected additionalStages() {
    return [{ key: "design", name: "Design the deliverable", kind: "design" }];
  }

  protected skillAffinity(): string[] {
    return ["writing", "planning", "documentation"];
  }

  protected answerDirectives(input: RoutingInput): string[] {
    const sections = input.analysis?.successCriteria ?? [];
    return [
      "Produce the complete deliverable, not a description of it.",
      "Use headings so the structure is visible.",
      sections.length
        ? `The deliverable must satisfy: ${sections.join("; ")}.`
        : "Cover every part the objective asks for.",
      "Mark anything you could not produce as missing rather than omitting it silently.",
    ];
  }

  protected async customStage(context: ArmStageContext) {
    if ((context.work.stageInput.stageKind as string) !== "design") {
      return super.customStage(context);
    }
    const analysis = context.state.analysis as
      { successCriteria: string[] } | undefined;
    const outline = analysis?.successCriteria ?? [];
    context.state.outline = outline;
    return {
      kind: "COMPLETE" as const,
      output: { outline, sections: outline.length },
    };
  }

  protected checksFor(context: ArmStageContext, answer: string) {
    const outline = (context.state.outline as string[] | undefined) ?? [];
    return [
      structureCheck({
        id: "deliverable-present",
        required: true,
        requiredFields: ["answer"],
        minLength: 120,
      }),
      {
        id: "has-structure",
        type: "STRUCTURE" as const,
        required: true,
        run: () => {
          const headings = answer.match(/^#{1,6}\s+\S|^\s*\d+\.\s+\S/gm) ?? [];
          return headings.length >= 2
            ? {
                status: "passed" as const,
                detail: `Deliverable has ${headings.length} structural markers.`,
                evidence: { headings: headings.length },
              }
            : {
                status: "failed" as const,
                detail:
                  "Deliverable has no visible structure; at least two headings or numbered sections are required.",
                evidence: { headings: headings.length },
              };
        },
      },
      {
        id: "outline-covered",
        type: "STRUCTURE" as const,
        required: false,
        run: () => {
          if (outline.length === 0) {
            return {
              status: "inconclusive" as const,
              detail: "No outline was produced to compare against.",
            };
          }
          const body = answer.toLowerCase();
          const missing = outline.filter((item) => {
            const terms = (item.toLowerCase().match(/[a-z]{4,}/g) ?? []).slice(
              0,
              6,
            );
            if (terms.length === 0) return false;
            return (
              terms.filter((term) => body.includes(term)).length /
                terms.length <
              0.5
            );
          });
          return missing.length === 0
            ? {
                status: "passed" as const,
                detail: `All ${outline.length} planned section(s) appear in the deliverable.`,
                evidence: { outline },
              }
            : {
                status: "failed" as const,
                detail: `Planned section(s) missing from the deliverable: ${missing.join("; ")}.`,
                evidence: { missing },
              };
        },
      },
      secretLeakCheck(),
    ];
  }
}
