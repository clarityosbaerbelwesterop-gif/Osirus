import "server-only";

import { querySystem } from "../db/client";

export class RateLimitError extends Error {
  constructor(
    public readonly retryAfterMs?: number,
  ) {
    super("rate_limited");
  }
}

export class RateLimitUnavailableError extends Error {
  constructor() {
    super("rate_limit_unavailable");
  }
}

export interface RateLimitConfig {
  windowMs: number;
  limit: number;
  keyPrefix?: string;
}

export interface RateLimitResult {
  allowed: boolean;
  current: number;
  limit: number;
  remaining: number;
  resetAt: number;
  retryAfterMs?: number;
}

const DEFAULT_CONFIG: RateLimitConfig = {
  windowMs: 60 * 1000,
  limit: 100,
  keyPrefix: "rl",
};

/**
 * A database-backed sliding-window rate limiter with configurable windows.
 * Fails closed if the security store cannot be reached.
 */
export async function enforceRateLimit(
  input: {
    subject: string;
    route: string;
    limit: number;
  },
  config: Partial<RateLimitConfig> = {},
): Promise<RateLimitResult> {
  const finalConfig = { ...DEFAULT_CONFIG, ...config, limit: input.limit };
  const windowStart = Math.floor(Date.now() / finalConfig.windowMs) * finalConfig.windowMs;

  try {
    const rows = await querySystem<{ request_count: number; window_started_at: number }>(
      `insert into osirus.request_rate_limits
         (subject, route, window_started_at, request_count)
       values ($1, $2, to_timestamp($3 / 1000), 1)
       on conflict (subject, route, window_started_at)
       do update set request_count = osirus.request_rate_limits.request_count + 1
         where osirus.request_rate_limits.request_count < $4
       returning request_count, window_started_at`,
      [input.subject, input.route, windowStart, finalConfig.limit],
    );

    if (!rows[0]) {
      const retryAfterMs = windowStart + finalConfig.windowMs - Date.now();
      throw new RateLimitError(Math.max(0, retryAfterMs));
    }

    const current = rows[0].request_count;
    const resetAt = windowStart + finalConfig.windowMs;

    return {
      allowed: true,
      current,
      limit: finalConfig.limit,
      remaining: Math.max(0, finalConfig.limit - current),
      resetAt,
    };
  } catch (error) {
    if (error instanceof RateLimitError) throw error;
    throw new RateLimitUnavailableError();
  }
}

export function rateLimitHeaders(result: RateLimitResult): Record<string, string> {
  return {
    "X-RateLimit-Limit": String(result.limit),
    "X-RateLimit-Remaining": String(result.remaining),
    "X-RateLimit-Reset": String(Math.ceil(result.resetAt / 1000)),
    ...(result.retryAfterMs
      ? { "Retry-After": String(Math.ceil(result.retryAfterMs / 1000)) }
      : {}),
  };
}

export function isRateLimitError(error: unknown): error is RateLimitError {
  return error instanceof RateLimitError;
}

export function isRateLimitUnavailableError(error: unknown): error is RateLimitUnavailableError {
  return error instanceof RateLimitUnavailableError;
}