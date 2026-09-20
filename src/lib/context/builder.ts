export type ContextPart = {
  kind: string;
  text: string;
  priority: number;
  estimatedTokens: number;
};
export function buildContext(parts: ContextPart[], budget: number) {
  let used = 0;
  return [...parts]
    .sort((a, b) => b.priority - a.priority)
    .filter((p) => {
      if (used + p.estimatedTokens > budget) return false;
      used += p.estimatedTokens;
      return true;
    });
}
