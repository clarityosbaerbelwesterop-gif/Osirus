import type { RougeMessage, RougeUsage } from "./types";

// The foundation boundary (M56).
//
//   Rouge -> FoundationAdapter -> (UnoRouter) -> core model
//
// Rouge never talks to a provider directly. An adapter serves one core and
// says what that core can do; Rouge's policies decide how to use it. Moving
// Rouge to a new core (Grok 5, say) means a new CoreSpec and an evaluation
// -- raw new core vs Rouge on the old core vs Rouge on the new one -- never
// an automatic switch (see docs/rouge/architecture.md, "Core migration").

export type ReasoningLevel = "low" | "medium" | "high" | "xhigh";

export type CoreSpec = {
  /** The provider's model id, e.g. "grok-4.6". */
  id: string;
  family: string;
  /**
   * The context window the core attends to natively, in tokens. Rouge's
   * managed context (M59) may exceed it; each call never does.
   */
  nativeContextTokens: number;
  /** Reasoning levels the core accepts; empty when it has no such control. */
  reasoningLevels: readonly ReasoningLevel[];
  /** Image input: only true once verified against the provider. */
  vision: boolean;
  /** Where these numbers come from, so nobody mistakes them for measurements. */
  source: string;
};

export type FoundationEvent =
  { type: "delta"; text: string } | { type: "usage"; usage: RougeUsage };

export type FoundationCall = {
  requestId: string;
  /** Rouge's own system instruction, sent first. */
  system: string;
  messages: RougeMessage[];
  /** Omitted when the core has no reasoning control. */
  reasoning?: ReasoningLevel;
  /**
   * Whether a refusal of this core may be answered by another model. False
   * for every evaluation: a comparison must stay on the core it names.
   */
  allowSubstitute: boolean;
  signal?: AbortSignal;
};

export interface FoundationAdapter {
  readonly core: CoreSpec;
  stream(call: FoundationCall): AsyncIterable<FoundationEvent>;
  /** The model that served a finished call, once known. */
  servedModel(requestId: string): string | undefined;
}

/**
 * Cores Rouge knows how to drive. Numbers are the operator's configuration
 * of each core, recorded with their source; nothing here is measured by
 * Rouge. An id missing from this table can still be used with conservative
 * defaults (no reasoning control, no vision, a small window).
 */
export const CORES: Record<string, CoreSpec> = {
  "grok-4.6": {
    id: "grok-4.6",
    family: "grok",
    nativeContextTokens: 500_000,
    reasoningLevels: ["low", "medium", "high", "xhigh"],
    // Grok image input is planned for M71 and not yet verified here.
    vision: false,
    source:
      "operator specification (Rouge brief, 2026-09-27); reasoning_effort contract verified in models/unorouter.ts",
  },
};

export function coreSpec(id: string): CoreSpec {
  return (
    CORES[id] ?? {
      id,
      family: id.split(/[-:]/)[0] ?? id,
      nativeContextTokens: 32_000,
      reasoningLevels: [],
      vision: false,
      source: "unknown core: conservative defaults",
    }
  );
}
