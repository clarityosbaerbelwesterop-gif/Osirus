import "server-only";

import { querySystem } from "../db/client";

export class RateLimitError extends Error {
  constructor() {
    super("rate_limited");
  }
}

export class RateLimitUnavailableError extends Error {
  constructor() {
    super("rate_limit_unavailable");
  }
}

/**
 * A database-backed fixed-window limiter. It is intentionally conservative:
 * if the security store cannot be reached, mutation requests fail closed.
 */
export async function enforceRateLimit(input: {
  subject: string;
  route: string;
  limit: number;
}) {
  try {
    const rows = await querySystem<{ request_count: number }>(
      `insert into osirus.request_rate_limits
         (subject, route, window_started_at, request_count)
       values ($1, $2, date_trunc('minute', now()), 1)
       on conflict (subject, route, window_started_at)
       do update set request_count = osirus.request_rate_limits.request_count + 1
         where osirus.request_rate_limits.request_count < $3
       returning request_count`,
      [input.subject, input.route, Math.max(1, Math.floor(input.limit))],
    );
    if (!rows[0]) throw new RateLimitError();
    return rows[0].request_count;
  } catch (error) {
    if (error instanceof RateLimitError) throw error;
    throw new RateLimitUnavailableError();
  }
}
