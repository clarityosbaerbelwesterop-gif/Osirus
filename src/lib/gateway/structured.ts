import { ProviderError } from "@/lib/models/unorouter";
import type { Usage } from "@/lib/models/provider";
import { extractJsonObject, jsonObjectCandidates } from "./json";

// Structured output that does not give up on the first bad reply.
//
// Live 2026-10-30: a Rouge run stalled on "Model reply was not a valid
// decision": the model answered JSON, but not in the decision format, and the
// call failed at once. No repair, no other model. Now:
//
//   1. Every JSON object in the reply is tried, best guess first (a model
//      that shows an example before its real answer still counts).
//   2. A reply without JSON, or with JSON that does not validate, gets one
//      repair turn on the same model, naming the exact problem.
//   3. When the repair fails too, one fresh attempt (another model, where the
//      provider can choose one) before the error reaches the loop.
//
// Errors keep their type: no JSON is ProviderError "invalid_json", a wrong
// shape is the validator's own error, so callers handle them as before.

export const JSON_REPAIR =
  "Your previous reply could not be read as JSON. Reply again with exactly one JSON object and nothing else: no prose, no code fence.";

const PROBLEM_CHARS = 300;

export function shapeRepair(problem: string) {
  return `Your previous JSON object did not match the required format: ${problem.replace(/\s+/g, " ").slice(0, PROBLEM_CHARS)}. Reply again with exactly one JSON object in the required format and nothing else: no prose, no code fence.`;
}

type Read<T> =
  { ok: true; value: T } | { ok: false; error: unknown; repair: string };

/** The first object in the reply that validates, or why none does. */
export function readStructured<T>(
  text: string,
  validate: (value: unknown) => T,
): Read<T> {
  const first = extractJsonObject(text);
  if (first === undefined)
    return {
      ok: false,
      error: new ProviderError(
        "Structured model response did not contain JSON",
        "invalid_json",
      ),
      repair: JSON_REPAIR,
    };
  let firstError: unknown;
  for (const candidate of [first, ...jsonObjectCandidates(text)]) {
    try {
      return { ok: true, value: validate(candidate) };
    } catch (error) {
      firstError ??= error;
    }
  }
  const problem =
    firstError instanceof Error ? firstError.message : String(firstError);
  return { ok: false, error: firstError, repair: shapeRepair(problem) };
}

export function addUsage(total: Usage, next: Usage): Usage {
  const sum = (a?: number, b?: number) =>
    a === undefined && b === undefined ? undefined : (a ?? 0) + (b ?? 0);
  return {
    inputTokens: sum(total.inputTokens, next.inputTokens),
    outputTokens: sum(total.outputTokens, next.outputTokens),
    cost: sum(total.cost, next.cost),
  };
}

export type StructuredCall = (
  messages: unknown[],
  requestId: string,
  /** 0 first answer, 1 repair on the same model, 2 fresh attempt. */
  attempt: 0 | 1 | 2,
) => Promise<{ text: string; usage: Usage } | null>;

/**
 * Runs the three steps above. `call` returns null for an attempt the
 * provider cannot make (no other model left for the fresh attempt).
 */
export async function structuredWithRepair<T>(input: {
  requestId: string;
  messages: unknown[];
  validate: (value: unknown) => T;
  signal?: AbortSignal;
  call: StructuredCall;
  /** Told when a model gave two unusable replies in a row. */
  onUnusable?: () => void;
}): Promise<{ value: T; usage: Usage }> {
  const first = await input.call(input.messages, input.requestId, 0);
  if (!first) throw new ProviderError("No model answered", "provider_error");
  let usage = first.usage;
  let read = readStructured(first.text, input.validate);
  if (read.ok) return { value: read.value, usage };

  // The first error is what the loop shows when nothing helps.
  const original = read.error;
  const later = async (
    messages: unknown[],
    requestId: string,
    attempt: 1 | 2,
  ) => {
    try {
      return await input.call(messages, requestId, attempt);
    } catch (error) {
      // A pause or cancel stops here; any other failure of a retry leaves
      // the original problem as the answer.
      if (input.signal?.aborted) throw error;
      return null;
    }
  };

  const repaired = await later(
    [
      ...input.messages,
      { role: "assistant", content: first.text.slice(0, 4000) },
      { role: "user", content: read.repair },
    ],
    `${input.requestId}:repair`,
    1,
  );
  if (repaired) {
    usage = addUsage(usage, repaired.usage);
    read = readStructured(repaired.text, input.validate);
    if (read.ok) return { value: read.value, usage };
  }
  input.onUnusable?.();

  const fresh = await later(input.messages, `${input.requestId}:fresh`, 2);
  if (fresh) {
    usage = addUsage(usage, fresh.usage);
    read = readStructured(fresh.text, input.validate);
    if (read.ok) return { value: read.value, usage };
  }
  throw original;
}
