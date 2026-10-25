import "server-only";
import { queryAs } from "../db/client";

export type QuotaWindow = "five_hour" | "weekly";

export type QuotaUsage = {
  modelCalls: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
};

export type QuotaLimit = {
  limit: number;
  used: number;
  remaining: number;
  resetsAt: string;
  windowType: QuotaWindow;
};

export async function getQuotaUsage(
  userId: string,
  workspaceId: string,
): Promise<{
  fiveHour: QuotaLimit;
  weekly: QuotaLimit;
}> {
  const fiveHourWindow = getWindowStart("five_hour");
  const weeklyWindow = getWindowStart("weekly");

  const [fiveHourUsage, weeklyUsage, fiveHourLimit, weeklyLimit] =
    await Promise.all([
      getWindowUsage(userId, workspaceId, "five_hour", fiveHourWindow),
      getWindowUsage(userId, workspaceId, "weekly", weeklyWindow),
      getEntitlement(userId, workspaceId, "free_tier_five_hour_calls", "50"),
      getEntitlement(userId, workspaceId, "free_tier_weekly_calls", "200"),
    ]);

  return {
    fiveHour: {
      limit: fiveHourLimit,
      used: fiveHourUsage.modelCalls,
      remaining: Math.max(0, fiveHourLimit - fiveHourUsage.modelCalls),
      resetsAt: new Date(fiveHourWindow.getTime() + 5 * 60 * 60 * 1000).toISOString(),
      windowType: "five_hour",
    },
    weekly: {
      limit: weeklyLimit,
      used: weeklyUsage.modelCalls,
      remaining: Math.max(0, weeklyLimit - weeklyUsage.modelCalls),
      resetsAt: new Date(weeklyWindow.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      windowType: "weekly",
    },
  };
}

async function getWindowUsage(
  userId: string,
  workspaceId: string,
  windowType: QuotaWindow,
  windowStartedAt: Date,
): Promise<QuotaUsage> {
  const rows = await queryAs<{
    model_calls: number;
    input_tokens: number;
    output_tokens: number;
    estimated_cost_usd: string | number | null;
  }>(
    userId,
    `select
        coalesce(sum(model_calls), 0)::int as model_calls,
        coalesce(sum(input_tokens), 0)::int as input_tokens,
        coalesce(sum(output_tokens), 0)::int as output_tokens,
        coalesce(sum(estimated_cost_usd), 0) as estimated_cost_usd
       from osirus.free_tier_quotas
      where workspace_id = $1::uuid
        and window_type = $2
        and window_started_at = $3`,
    [workspaceId, windowType, windowStartedAt],
  ).catch(() => []);

  const row = rows[0];
  return {
    modelCalls: row?.model_calls ?? 0,
    inputTokens: row?.input_tokens ?? 0,
    outputTokens: row?.output_tokens ?? 0,
    costUsd: Number(row?.estimated_cost_usd ?? 0),
  };
}

async function getEntitlement(
  userId: string,
  workspaceId: string,
  key: string,
  defaultValue: string,
): Promise<number> {
  const rows = await queryAs<{ value: string }>(
    userId,
    `select value from osirus.entitlements
       where workspace_id = $1::uuid and key = $2`,
    [workspaceId, key],
  ).catch(() => []);

  const value = rows[0]?.value ?? defaultValue;
  return parseInt(value, 10);
}

function getWindowStart(windowType: QuotaWindow): Date {
  const now = new Date();
  if (windowType === "five_hour") {
    const hours = now.getUTCHours();
    const windowHour = Math.floor(hours / 5) * 5;
    return new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), windowHour, 0, 0),
    );
  }
  // Weekly window starts on Monday 00:00 UTC
  const day = now.getUTCDay();
  const daysSinceMonday = (day + 6) % 7;
  const monday = new Date(now);
  monday.setUTCDate(now.getUTCDate() - daysSinceMonday);
  monday.setUTCHours(0, 0, 0, 0);
  return monday;
}

export async function recordQuotaUsage(
  userId: string,
  workspaceId: string,
  usage: QuotaUsage,
): Promise<void> {
  const fiveHourWindow = getWindowStart("five_hour");
  const weeklyWindow = getWindowStart("weekly");

  await Promise.all([
    upsertWindowUsage(
      userId,
      workspaceId,
      "five_hour",
      fiveHourWindow,
      usage,
    ),
    upsertWindowUsage(
      userId,
      workspaceId,
      "weekly",
      weeklyWindow,
      usage,
    ),
  ]);
}

async function upsertWindowUsage(
  userId: string,
  workspaceId: string,
  windowType: QuotaWindow,
  windowStartedAt: Date,
  usage: QuotaUsage,
): Promise<void> {
  await queryAs(
    userId,
    `insert into osirus.free_tier_quotas
       (workspace_id, window_type, window_started_at, model_calls, input_tokens, output_tokens, estimated_cost_usd)
     values ($1::uuid, $2, $3, $4, $5, $6, $7)
     on conflict (workspace_id, window_type, window_started_at)
     do update set
       model_calls = osirus.free_tier_quotas.model_calls + $4,
       input_tokens = osirus.free_tier_quotas.input_tokens + $5,
       output_tokens = osirus.free_tier_quotas.output_tokens + $6,
       estimated_cost_usd = osirus.free_tier_quotas.estimated_cost_usd + $7`,
    [
      workspaceId,
      windowType,
      windowStartedAt,
      usage.modelCalls,
      usage.inputTokens,
      usage.outputTokens,
      usage.costUsd,
    ],
  ).catch(() => undefined);
}

export async function isQuotaExhausted(
  userId: string,
  workspaceId: string,
): Promise<{ exhausted: boolean; windowType: QuotaWindow | null }> {
  const usage = await getQuotaUsage(userId, workspaceId);
  if (usage.fiveHour.remaining <= 0) {
    return { exhausted: true, windowType: "five_hour" };
  }
  if (usage.weekly.remaining <= 0) {
    return { exhausted: true, windowType: "weekly" };
  }
  return { exhausted: false, windowType: null };
}