export type ModelRole =
  "FAST" | "STRONG" | "CODING" | "RESEARCH" | "MATH" | "VERIFY";

export type Usage = {
  inputTokens?: number;
  outputTokens?: number;
  cost?: number;
};

export type ModelStreamEvent =
  { type: "delta"; text: string } | { type: "usage"; usage: Usage };

export interface ModelProvider {
  stream(input: {
    requestId: string;
    role: ModelRole;
    messages: unknown[];
    signal?: AbortSignal;
  }): AsyncIterable<ModelStreamEvent>;
  complete(input: {
    requestId: string;
    role: ModelRole;
    messages: unknown[];
    signal?: AbortSignal;
  }): Promise<{ text: string; usage: Usage }>;
  structured<T>(input: {
    requestId: string;
    role: ModelRole;
    messages: unknown[];
    validate: (value: unknown) => T;
    signal?: AbortSignal;
  }): Promise<{ value: T; usage: Usage }>;
  capabilities(): Promise<Record<string, unknown>>;
  healthCheck(): Promise<boolean>;
  cancel(id: string): Promise<void>;
  normalizeUsage(raw: unknown): Usage;
  normalizeError(error: unknown): Error;
}
