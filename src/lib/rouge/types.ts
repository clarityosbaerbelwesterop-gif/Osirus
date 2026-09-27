// Rouge 1: the contracts every layer above the foundation speaks (M56).
//
// Rouge is a model system: a foundation model (initially Grok 4.6 through
// UnoRouter) plus Rouge's own cognition, context, memory, verification and
// learned policies. These types are the boundary between the two. Nothing
// here names UnoRouter or a vendor: the foundation behind them is swappable
// (see foundation.ts), and Rouge's policies, memory and identity survive a
// core change.

/** How hard Rouge thinks. Mapped onto the core's reasoning levels by policy. */
export type RougeEffort = "quick" | "standard" | "deep" | "ultra";

/** "auto" lets Rouge choose; M58 replaces the fixed default with a controller. */
export type RougeEffortRequest = RougeEffort | "auto";

export const ROUGE_EFFORTS: readonly RougeEffort[] = [
  "quick",
  "standard",
  "deep",
  "ultra",
];

export type RougeMessage = {
  role: "user" | "assistant";
  content: string;
};

export type RougeRequest = {
  /** Idempotency and correlation id; never reused across requests. */
  requestId: string;
  /** The conversation so far, oldest first, ending with the user's turn. */
  messages: RougeMessage[];
  effort?: RougeEffortRequest;
  signal?: AbortSignal;
};

export type RougeUsage = {
  inputTokens: number;
  outputTokens: number;
  /** Provider-reported cost, when the provider reports one. */
  cost: number | null;
};

/**
 * Which model actually answered. `substituted` is true when the requested
 * core could not serve (no credit, unknown model, outage) and a different
 * model did. A substituted answer is labelled as such everywhere -- in the
 * UI, in telemetry, and above all in evaluations, which must never count it
 * as the requested core's work.
 */
export type RougeCoreServed = {
  requested: string;
  served: string;
  substituted: boolean;
};

export type RougeVersion = {
  /** Product name, e.g. "Rouge 1". */
  name: string;
  /** Rouge system release; changes when Rouge's own code or policy changes. */
  release: string;
  /** The policy version that shaped this answer. */
  policy: string;
  /** The foundation core the policy asked for. */
  core: string;
};

export type RougeResponse = {
  requestId: string;
  text: string;
  effort: RougeEffort;
  version: RougeVersion;
  core: RougeCoreServed;
  usage: RougeUsage;
  latencyMs: number;
  /** Time to the first streamed token; null when nothing streamed. */
  firstTokenMs: number | null;
  /** What the kernel did (M57); absent under the foundation policy. */
  kernel?: {
    contract: string;
    contractMet: boolean | null;
    repairs: number;
  };
};

/**
 * What a caller sees while Rouge works. `status` carries a short,
 * human-readable activity label -- never private reasoning text.
 */
export type RougeStreamEvent =
  | { type: "status"; label: string }
  | { type: "delta"; text: string }
  | { type: "done"; response: RougeResponse };

export class RougeError extends Error {
  constructor(
    message: string,
    /** A provider refusal code (insufficient_credit, rate_limited, ...) or a Rouge code. */
    readonly code: string,
    readonly core: RougeCoreServed | null = null,
  ) {
    super(message);
    this.name = "RougeError";
  }
}
