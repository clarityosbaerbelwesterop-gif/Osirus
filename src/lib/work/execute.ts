import { z } from "zod";
import type { WorkSelection } from "./selection";
import { executionBlocker } from "./selection";

export type WorkCaller = {
  complete(input: {
    modelId: string;
    purpose: "executor" | "subagent" | "reviewer";
    messages: { role: "system" | "user"; content: string }[];
  }): Promise<{
    text: string;
    inputTokens?: number;
    outputTokens?: number;
    costUsd?: number;
  }>;
};

export type SubagentStatus = {
  index: number;
  modelId: string;
  status: "completed" | "failed" | "unavailable";
  text: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
  error: string | null;
};

export type ReviewVerdict =
  "passed" | "revise" | "rejected" | "unverified" | "unavailable";

export type WorkExecution = {
  status: "completed" | "unavailable" | "failed";
  message: string | null;
  executorText: string | null;
  subagents: SubagentStatus[];
  review: {
    modelId: string;
    verdict: ReviewVerdict;
    findings: string | null;
    inputTokens: number | null;
    outputTokens: number | null;
    costUsd: number | null;
  };
};

const planSchema = z.object({
  parts: z.array(z.string().trim().min(1).max(4_000)).min(1).max(50),
});

const verdictSchema = z.object({
  verdict: z.enum(["passed", "revise", "rejected"]),
  findings: z.string().max(8_000).optional(),
});

function parseJson(text: string) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1)) as unknown;
  } catch {
    return null;
  }
}

/**
 * Main model, then N sub-agents on that same model, then a different reviewer.
 * Placeholder models and a missing caller do not produce an answer.
 */
export async function executeWork(input: {
  prompt: string;
  selection: WorkSelection;
  caller: WorkCaller | null;
}): Promise<WorkExecution> {
  const blocked = executionBlocker(input.selection);
  const emptyReview = {
    modelId: input.selection.reviewerModelId,
    verdict: "unavailable" as const,
    findings: null,
    inputTokens: null,
    outputTokens: null,
    costUsd: null,
  };
  if (blocked || !input.caller) {
    return {
      status: "unavailable",
      message:
        blocked ??
        "Bald verfügbar. UNOROUTER ist für diesen Lauf nicht konfiguriert.",
      executorText: null,
      subagents: Array.from(
        { length: input.selection.subAgentCount },
        (_, index) => ({
          index,
          modelId: input.selection.executorModelId,
          status: "unavailable" as const,
          text: null,
          inputTokens: null,
          outputTokens: null,
          costUsd: null,
          error: blocked ?? "provider_not_configured",
        }),
      ),
      review: emptyReview,
    };
  }

  const caller = input.caller;
  const executorId = input.selection.executorModelId;
  let executorText: string;
  try {
    if (input.selection.subAgentCount === 0) {
      const answer = await caller.complete({
        modelId: executorId,
        purpose: "executor",
        messages: [
          {
            role: "system",
            content:
              "Beantworte die Aufgabe. Erfinde keine Prüfergebnisse und keine Modellnamen.",
          },
          { role: "user", content: input.prompt },
        ],
      });
      executorText = answer.text;
    } else {
      const planned = await caller.complete({
        modelId: executorId,
        purpose: "executor",
        messages: [
          {
            role: "system",
            content: `Teile die Aufgabe in genau ${input.selection.subAgentCount} Teilaufgaben. Antworte nur mit JSON {"parts":["..."]}.`,
          },
          { role: "user", content: input.prompt },
        ],
      });
      executorText = planned.text;
    }
  } catch (error) {
    return {
      status: "failed",
      message: error instanceof Error ? error.message : "executor_failed",
      executorText: null,
      subagents: [],
      review: { ...emptyReview, verdict: "unavailable" },
    };
  }

  const subagents: SubagentStatus[] = [];
  let parts: string[] | null = null;
  if (input.selection.subAgentCount > 0) {
    const parsed = planSchema.safeParse(parseJson(executorText));
    if (
      !parsed.success ||
      parsed.data.parts.length !== input.selection.subAgentCount
    ) {
      for (let index = 0; index < input.selection.subAgentCount; index += 1) {
        subagents.push({
          index,
          modelId: executorId,
          status: "failed",
          text: null,
          inputTokens: null,
          outputTokens: null,
          costUsd: null,
          error: "plan_unreadable",
        });
      }
    } else {
      parts = parsed.data.parts;
    }
  }

  if (parts) {
    for (let index = 0; index < parts.length; index += 1) {
      try {
        const result = await caller.complete({
          modelId: executorId,
          purpose: "subagent",
          messages: [
            {
              role: "system",
              content: `Du bist Subagent ${index + 1} von ${parts.length}. Bearbeite nur diese Teilaufgabe.`,
            },
            { role: "user", content: parts[index]! },
          ],
        });
        subagents.push({
          index,
          modelId: executorId,
          status: "completed",
          text: result.text,
          inputTokens: result.inputTokens ?? null,
          outputTokens: result.outputTokens ?? null,
          costUsd: result.costUsd ?? null,
          error: null,
        });
      } catch (error) {
        subagents.push({
          index,
          modelId: executorId,
          status: "failed",
          text: null,
          inputTokens: null,
          outputTokens: null,
          costUsd: null,
          error: error instanceof Error ? error.message : "subagent_failed",
        });
      }
    }
  }

  const merged = [
    executorText,
    ...subagents
      .filter((item) => item.text)
      .map((item) => `Subagent ${item.index + 1}: ${item.text}`),
  ].join("\n\n");

  try {
    const review = await caller.complete({
      modelId: input.selection.reviewerModelId,
      purpose: "reviewer",
      messages: [
        {
          role: "system",
          content:
            'Prüfe das Ergebnis. Antworte nur mit JSON {"verdict":"passed"|"revise"|"rejected","findings":"..."}. Wenn du es nicht beurteilen kannst, schreibe kein passed.',
        },
        { role: "user", content: merged.slice(0, 20_000) },
      ],
    });
    const parsed = verdictSchema.safeParse(parseJson(review.text));
    return {
      status: subagents.some((item) => item.status === "failed")
        ? "failed"
        : "completed",
      message: null,
      executorText,
      subagents,
      review: {
        modelId: input.selection.reviewerModelId,
        verdict: parsed.success ? parsed.data.verdict : "unverified",
        findings: parsed.success
          ? (parsed.data.findings ?? review.text)
          : review.text,
        inputTokens: review.inputTokens ?? null,
        outputTokens: review.outputTokens ?? null,
        costUsd: review.costUsd ?? null,
      },
    };
  } catch (error) {
    return {
      status: "failed",
      message: error instanceof Error ? error.message : "review_failed",
      executorText,
      subagents,
      review: {
        ...emptyReview,
        verdict: "unavailable",
        findings: null,
      },
    };
  }
}
