import "server-only";
import { querySystem } from "../db/client";
import type { MeasuredStat } from "./measured";

const WINDOW_HOURS = 24;
const CACHE_MS = 5 * 60 * 1000;

let cached: { at: number; stats: Map<string, MeasuredStat> } | null = null;

/**
 * Per model, the agent decisions of the last 24 hours across all instances
 * (calls, failures, median latency). Cached for five minutes; empty when the
 * database cannot be read, so the ranking alone decides.
 */
export async function measuredModelStats(
  now = Date.now(),
): Promise<Map<string, MeasuredStat>> {
  if (cached && now - cached.at < CACHE_MS) return cached.stats;
  try {
    const rows = await querySystem<{
      model: string;
      calls: string | number;
      failed: string | number;
      p50: string | number | null;
    }>(
      `select model,
              count(*) as calls,
              count(*) filter (where status = 'failed') as failed,
              percentile_cont(0.5) within group (order by latency_ms) as p50
         from osirus.model_calls
        where created_at > now() - make_interval(hours => $1)
          and request_metadata ? 'loopCall'
          and latency_ms is not null
        group by model`,
      [WINDOW_HOURS],
    );
    const stats = new Map<string, MeasuredStat>();
    for (const row of rows)
      stats.set(row.model, {
        calls: Number(row.calls),
        failed: Number(row.failed),
        p50Ms: Number(row.p50 ?? 0),
      });
    cached = { at: now, stats };
    return stats;
  } catch {
    return new Map();
  }
}
