export type ContextBucket =
  | "runtime"
  | "objective"
  | "plan"
  | "dialogue"
  | "memory"
  | "sources"
  | "artifacts"
  | "skills"
  | "tools"
  | "verification";

export type ContextPart = {
  kind: string;
  text: string;
  priority: number;
  estimatedTokens: number;
  bucket?: ContextBucket;
};

export type ContextBudget = {
  maxTokens: number;
  buckets: Record<ContextBucket, number>;
};

export type ContextSection = ContextPart & {
  bucket: ContextBucket;
  truncated: boolean;
};

export type ContextAssembly = {
  sections: ContextSection[];
  usedTokens: number;
  remainingTokens: number;
  omitted: string[];
  byBucket: Partial<Record<ContextBucket, number>>;
};

export type FirstBrainInput = {
  runtimeContract?: string;
  objective: string;
  plan?: string;
  recentDialogue?: string[];
  memory?: string[];
  sources?: string[];
  artifacts?: string[];
  skills?: string[];
  toolSchemas?: string[];
  verificationFeedback?: string[];
  budget?: Partial<ContextBudget>;
};

const defaultBuckets: Record<ContextBucket, number> = {
  runtime: 700,
  objective: 500,
  plan: 800,
  dialogue: 1200,
  memory: 1800,
  sources: 650,
  artifacts: 650,
  skills: 1400,
  tools: 500,
  verification: 400,
};

export function createContextBudget(
  overrides: Partial<ContextBudget> = {},
): ContextBudget {
  return {
    maxTokens: overrides.maxTokens ?? 8000,
    buckets: { ...defaultBuckets, ...overrides.buckets },
  };
}

function estimate(text: string) {
  return Math.max(1, Math.ceil(text.length / 4));
}

function truncate(text: string, tokens: number) {
  const maxCharacters = Math.max(0, tokens * 4);
  if (text.length <= maxCharacters) return { text, truncated: false };
  return {
    text: `${text.slice(0, Math.max(0, maxCharacters - 1))}…`,
    truncated: true,
  };
}

function part(
  bucket: ContextBucket,
  kind: string,
  text: string,
  priority: number,
): ContextPart | null {
  const normalized = text.trim();
  if (!normalized) return null;
  return {
    bucket,
    kind,
    text: normalized,
    priority,
    estimatedTokens: estimate(normalized),
  };
}

/**
 * The first brain is deliberately assembled from authoritative state rather
 * than mirroring a transcript. The legacy helper remains for simple callers.
 */
export function buildContext(parts: ContextPart[], budget: number) {
  let used = 0;
  return [...parts]
    .sort((a, b) => b.priority - a.priority)
    .filter((candidate) => {
      if (used + candidate.estimatedTokens > budget) return false;
      used += candidate.estimatedTokens;
      return true;
    });
}

export class ContextBuilder {
  build(input: FirstBrainInput): ContextAssembly {
    const budget = createContextBudget(input.budget);
    const candidates = [
      part("runtime", "runtime-contract", input.runtimeContract ?? "", 100),
      part("objective", "objective", input.objective, 99),
      part("plan", "active-plan", input.plan ?? "", 90),
      part(
        "verification",
        "verification-feedback",
        (input.verificationFeedback ?? []).join("\n"),
        88,
      ),
      part(
        "dialogue",
        "recent-dialogue",
        (input.recentDialogue ?? []).join("\n"),
        70,
      ),
      part("memory", "retrieved-memory", (input.memory ?? []).join("\n"), 65),
      part("sources", "selected-sources", (input.sources ?? []).join("\n"), 60),
      part(
        "artifacts",
        "selected-artifacts",
        (input.artifacts ?? []).join("\n"),
        55,
      ),
      part("skills", "active-skills", (input.skills ?? []).join("\n\n"), 50),
      part("tools", "tool-schemas", (input.toolSchemas ?? []).join("\n"), 40),
    ].filter((value): value is ContextPart => Boolean(value));

    let remaining = budget.maxTokens;
    const usedByBucket: Partial<Record<ContextBucket, number>> = {};
    const sections: ContextSection[] = [];
    const omitted: string[] = [];

    for (const candidate of candidates.sort(
      (left, right) => right.priority - left.priority,
    )) {
      const bucket = candidate.bucket ?? "memory";
      const bucketRemaining =
        budget.buckets[bucket] - (usedByBucket[bucket] ?? 0);
      const allowance = Math.min(remaining, bucketRemaining);
      if (allowance <= 0) {
        omitted.push(`${candidate.kind}:budget`);
        continue;
      }
      const clipped = truncate(candidate.text, allowance);
      const actualTokens = estimate(clipped.text);
      if (actualTokens > allowance) {
        omitted.push(`${candidate.kind}:budget`);
        continue;
      }
      sections.push({
        ...candidate,
        bucket,
        text: clipped.text,
        estimatedTokens: actualTokens,
        truncated: clipped.truncated,
      });
      usedByBucket[bucket] = (usedByBucket[bucket] ?? 0) + actualTokens;
      remaining -= actualTokens;
      if (clipped.truncated) omitted.push(`${candidate.kind}:truncated`);
    }

    return {
      sections,
      usedTokens: budget.maxTokens - remaining,
      remainingTokens: remaining,
      omitted,
      byBucket: usedByBucket,
    };
  }
}

export const contextBuilder = new ContextBuilder();

export function buildFirstBrain(input: FirstBrainInput) {
  return contextBuilder.build(input);
}
