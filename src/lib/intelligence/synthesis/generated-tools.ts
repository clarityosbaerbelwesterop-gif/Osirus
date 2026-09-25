import { z } from "zod";
import type { ArmId } from "../../arms/types";
import type { ToolDefinition } from "../../tools/registry";
import { analyzeSource, runIsolated } from "./isolation";

// Generated tools at run time (M43). Only a policy that names a candidate
// (genome.tools.include) gets it, and then only as a read-only, low-risk
// tool with trust "generated" whose every call runs in a fresh isolated
// process. The registry refuses a generated tool with any other effect.

type CandidateContent = {
  id: string;
  name: string;
  summary: string;
  inputSchema: {
    properties?: Record<string, { type: string; maxLength?: number }>;
    required?: string[];
  };
  source: string;
};

function zodFor(schema: CandidateContent["inputSchema"]) {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const [name, property] of Object.entries(schema.properties ?? {})) {
    const base =
      property.type === "string"
        ? z.string().max(property.maxLength ?? 10_000)
        : property.type === "number"
          ? z.number().finite()
          : property.type === "integer"
            ? z.number().int()
            : property.type === "boolean"
              ? z.boolean()
              : z.array(z.unknown()).max(1_000);
    shape[name] = (schema.required ?? []).includes(name)
      ? base
      : base.optional();
  }
  return z.object(shape).strict();
}

export function generatedToolDefinition(
  content: CandidateContent,
  arms: ArmId[],
): ToolDefinition | null {
  // Re-check at load: an artifact edited after the pipeline ran is refused.
  if (!analyzeSource(content.source).ok) return null;
  return {
    id: content.id,
    title: content.name,
    summary: `${content.summary} (generated tool, isolated)`,
    trust: "generated",
    effect: "read",
    risk: "low",
    arms,
    inputSchema: zodFor(content.inputSchema) as z.ZodType<unknown>,
    run: async (input) => {
      const run = await runIsolated(content.source, [input]);
      const result = run.results[0];
      if (!result?.ok)
        throw new Error(`generated_tool_failed: ${result?.error ?? run.fatal}`);
      return result.output;
    },
  };
}

export type GeneratedToolLoader = (ids: string[]) => Promise<ToolDefinition[]>;

/** Candidates named by the policy, from the Foundry's artifacts. */
export function foundryToolLoader(arm: ArmId): GeneratedToolLoader {
  return async (ids) => {
    if (!ids.length) return [];
    const { PgIntelStore } = await import("../store/pg-store");
    const artifacts = await new PgIntelStore().listArtifacts({
      kind: "tool_candidate",
      limit: 200,
    });
    return artifacts
      .filter(
        (artifact) =>
          (artifact.status === "proposed" || artifact.status === "active") &&
          ids.includes(String(artifact.content.id)),
      )
      .map((artifact) =>
        generatedToolDefinition(artifact.content as CandidateContent, [arm]),
      )
      .filter((tool): tool is ToolDefinition => Boolean(tool));
  };
}
