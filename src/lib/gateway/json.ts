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
function balancedObjects(text: string): string[] {
  const spans: string[] = [];
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
          spans.push(text.slice(start, index + 1));
          break;
        }
      }
    }
  }
  return spans;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

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
  const spans = balancedObjects(clean).sort((a, b) => b.length - a.length);
  for (const span of spans) {
    const parsed = tryParse(span);
    if (isRecord(parsed)) return parsed;
  }
  return undefined;
}
