export const USAGE_FIELDS: string[];

export type UsageFields = {
  total_granted: number | boolean | null;
  total_used: number | boolean | null;
  total_available: number | boolean | null;
  unlimited_quota: number | boolean | null;
  model_limits_enabled: number | boolean | null;
  expires_at: number | boolean | null;
};

export type KeyResult = {
  label: string;
  usage: { status: number | string } & UsageFields;
  models: {
    status: number | string;
    count: number;
    freeCount: number;
    freeModelIds: string[];
  };
};

export function pickUsage(body: unknown): UsageFields;
export function freeModelIds(body: unknown): string[];
export function modelIds(body: unknown): string[];
export function looksLikeChallenge(
  contentType: string | null | undefined,
  text: string | null | undefined,
): boolean;
export function keyDifferences(
  results: KeyResult[],
): Array<{ model: string; missingFrom: string[] }>;
export function renderMarkdown(report: {
  runAt: string;
  keys: KeyResult[];
  differences: Array<{ model: string; missingFrom: string[] }>;
}): string;
