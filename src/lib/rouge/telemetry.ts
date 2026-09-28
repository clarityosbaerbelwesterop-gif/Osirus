import type { ReasoningLevel } from "./foundation";
import type { RougeCognition, RougeEffort, RougeVersion } from "./types";

// Rouge telemetry (M56): one record per request, and never its content.
//
// No prompt, no answer, no user text: only what the capacity manager,
// arena and RSI need -- which version and core, how much effort, what it
// cost, how long it took, and how it ended. A substituted core is recorded
// as such, so no metric ever credits the requested core with another
// model's work.

export type RougeTelemetryRecord = {
  requestId: string;
  version: RougeVersion;
  effort: RougeEffort;
  reasoning: ReasoningLevel | null;
  coreRequested: string;
  coreServed: string | null;
  substituted: boolean;
  inputTokens: number;
  outputTokens: number;
  cost: number | null;
  latencyMs: number;
  firstTokenMs: number | null;
  outcome: "completed" | "failed" | "cancelled";
  errorCode: string | null;
  /** Kernel (M57): the answer's contract kind, whether it held, repairs spent. */
  contract?: string;
  contractMet?: boolean | null;
  repairs?: number;
  /** Deliberation metadata (p2). */
  cognition?: RougeCognition;
};

export interface RougeTelemetrySink {
  record(entry: RougeTelemetryRecord): void | Promise<void>;
}

/** Keeps records in memory: tests, the arena, and the live smoke. */
export class MemoryTelemetry implements RougeTelemetrySink {
  readonly records: RougeTelemetryRecord[] = [];
  record(entry: RougeTelemetryRecord) {
    this.records.push(entry);
  }
}

export const NO_TELEMETRY: RougeTelemetrySink = { record: () => undefined };
