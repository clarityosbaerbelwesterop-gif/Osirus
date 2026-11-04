// Finding the JSON object in a model's reply. Models wrap it in prose,
// fences, or a <think> block, and some add a trailing comma. Returns
// undefined when no object can be read -- the caller decides what then.

function stripThinking(text: string) {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
}

function tryParse(candidate: string): unknown {
  const trimmed = candidate.trim();
  if (!trimmed) return undefined;
  try {
    return JSON.parse(trimmed);
  } catch {
    try {
      return JSON.parse(trimmed.replace(/,\s*([}\]])/g, "$1"));
    } catch {
      return undefined;
    }
  }
}

/** Every balanced {...} span, string- and escape-aware, in order of appearance. */
function balancedObjects(text: string): Array<{ start: number; text: string }> {
  const spans: Array<{ start: number; text: string }> = [];
  for (
    let start = text.indexOf("{");
    start >= 0;
    start = text.indexOf("{", start + 1)
  ) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = start; index < text.length; index += 1) {
      const char = text[index];
      if (inString) {
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === '"') inString = false;
        continue;
      }
      if (char === '"') inString = true;
      else if (char === "{") depth += 1;
      else if (char === "}") {
        depth -= 1;
        if (depth === 0) {
          spans.push({ start, text: text.slice(start, index + 1) });
          break;
        }
      }
    }
  }
  return spans;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

/**
 * Every top-level JSON object of a reply, in order: fenced ones (last fence
 * first), then the objects written in the prose. Nested objects are left out:
 * a tool input inside a decision is not a decision of its own.
 */
export function jsonObjectCandidates(text: string): Record<string, unknown>[] {
  const clean = stripThinking(text);
  const found: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  const add = (value: unknown) => {
    if (!isRecord(value)) return;
    const key = JSON.stringify(value);
    if (seen.has(key)) return;
    seen.add(key);
    found.push(value);
  };
  add(tryParse(clean));
  for (const match of [
    ...clean.matchAll(/```(?:json|JSON)?\s*\n?([\s\S]*?)```/g),
  ].reverse())
    add(tryParse(match[1] ?? ""));
  let end = -1;
  for (const span of balancedObjects(clean)) {
    if (span.start <= end) continue;
    end = span.start + span.text.length - 1;
    add(tryParse(span.text));
  }
  return found;
}

/** The JSON object a reply carries, or undefined. */
export function extractJsonObject(
  text: string,
): Record<string, unknown> | undefined {
  const clean = stripThinking(text);
  const whole = tryParse(clean);
  if (isRecord(whole)) return whole;

  const fences = [...clean.matchAll(/```(?:json|JSON)?\s*\n?([\s\S]*?)```/g)]
    .map((match) => match[1])
    .reverse();
  for (const fence of fences) {
    const parsed = tryParse(fence);
    if (isRecord(parsed)) return parsed;
  }

  // Outermost objects first (they start earliest), then nested ones.
  const spans = balancedObjects(clean)
    .map((span) => span.text)
    .sort((a, b) => b.length - a.length);
  for (const span of spans) {
    const parsed = tryParse(span);
    if (isRecord(parsed)) return parsed;
  }
  return undefined;
}
