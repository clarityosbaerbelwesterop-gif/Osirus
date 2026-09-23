import { z } from "zod";
import type { ToolDefinition } from "../tools/registry";
import { analyzeRows, parseCsv, type Row } from "./data";
import type { ComputeEngine } from "./engine";
import { computeRequestSchema, type ComputeRequest } from "./types";

// Compute as tools the agent loop can call.
//
// compute.run returns the value AND an independent check of it. The model
// sees both, and the math arm's verifier reads the check -- so a result the
// second method disagrees with cannot quietly become the final answer.

export function computeTools(
  engine: () => Promise<ComputeEngine>,
): ToolDefinition[] {
  const run: ToolDefinition<ComputeRequest, unknown> = {
    id: "compute.run",
    title: "Compute",
    summary:
      "Evaluate, solve, simplify, differentiate, integrate, matrix ops, statistics, unit conversion and dimension checks. Returns the result and an independent check.",
    trust: "builtin",
    effect: "read",
    risk: "low",
    arms: [
      "math_science",
      "research",
      "general",
      "thinking",
      "building",
      "coding",
    ],
    inputSchema: computeRequestSchema,
    run: async (request, context) => {
      const instance = await engine();
      const result = await instance.compute(request, context.signal);
      const check = await instance.crossCheck(request, result);
      return { result, check, providers: instance.providerIds() };
    },
  };

  const data: ToolDefinition<
    {
      format: "csv" | "json";
      content: string;
      groupBy?: string;
      aggregate?: {
        column: string;
        fn: "sum" | "mean" | "count" | "min" | "max";
      };
    },
    unknown
  > = {
    id: "data.analyze",
    title: "Analyse tabular data",
    summary:
      "Schema, missing values, summary statistics, correlations, anomalies and group-by aggregates for CSV or JSON rows.",
    trust: "builtin",
    effect: "read",
    risk: "low",
    arms: ["math_science", "research", "general"],
    inputSchema: z.object({
      format: z.enum(["csv", "json"]),
      content: z.string().min(1).max(5_000_000),
      groupBy: z.string().max(120).optional(),
      aggregate: z
        .object({
          column: z.string().max(120),
          fn: z.enum(["sum", "mean", "count", "min", "max"]),
        })
        .optional(),
    }),
    run: async (input) => {
      let rows: Row[];
      if (input.format === "csv") rows = parseCsv(input.content);
      else {
        const parsed = JSON.parse(input.content) as unknown;
        if (!Array.isArray(parsed))
          throw new Error("json_must_be_an_array_of_objects");
        rows = parsed.filter(
          (row): row is Row => typeof row === "object" && row !== null,
        );
      }
      return analyzeRows(rows, {
        groupBy: input.groupBy,
        aggregate: input.aggregate,
      });
    },
  };

  return [run as ToolDefinition, data as ToolDefinition];
}
