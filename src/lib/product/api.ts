import "server-only";
import type { z } from "zod";
import type { ProductIdentity } from "../auth/bootstrap";
import {
  enforceRateLimit,
  RateLimitError,
  RateLimitUnavailableError,
} from "../security/rate-limit";
import { hasSameOrigin, readJsonBody } from "../security/request";
import { loadProductSession } from "./session";

// Shared guards for the product API routes: a signed-in identity, and for
// writes the same-origin check, a JSON body within a size limit, schema
// validation and a per-user rate limit -- the same order the existing
// runtime and session routes apply by hand.

export function json(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function apiIdentity(): Promise<ProductIdentity | null> {
  const session = await loadProductSession();
  return session?.identity ?? null;
}

export async function guardWrite<T extends z.ZodTypeAny>(
  request: Request,
  input: { schema: T; route: string; limit: number; maxBytes?: number },
): Promise<
  | { ok: true; identity: ProductIdentity; body: z.infer<T> }
  | { ok: false; response: Response }
> {
  const identity = await apiIdentity();
  if (!identity)
    return { ok: false, response: json({ error: "unauthorized" }, 401) };
  if (!hasSameOrigin(request))
    return { ok: false, response: json({ error: "invalid_origin" }, 403) };
  if (
    !request.headers
      .get("content-type")
      ?.toLowerCase()
      .startsWith("application/json")
  )
    return {
      ok: false,
      response: json({ error: "unsupported_media_type" }, 415),
    };
  const raw = await readJsonBody(request, input.maxBytes ?? 16 * 1024);
  if (!raw.ok)
    return {
      ok: false,
      response: json(
        { error: raw.error },
        raw.error === "payload_too_large" ? 413 : 400,
      ),
    };
  const parsed = input.schema.safeParse(raw.value);
  if (!parsed.success)
    return { ok: false, response: json({ error: "invalid_request" }, 400) };
  try {
    await enforceRateLimit({
      subject: `user:${identity.userId}`,
      route: input.route,
      limit: input.limit,
    });
  } catch (error) {
    if (error instanceof RateLimitError)
      return { ok: false, response: json({ error: "rate_limited" }, 429) };
    if (error instanceof RateLimitUnavailableError)
      return {
        ok: false,
        response: json({ error: "service_unavailable" }, 503),
      };
    throw error;
  }
  return { ok: true, identity, body: parsed.data };
}

/** For deletes and body-less posts: identity, same origin, rate limit. */
export async function guardAction(
  request: Request,
  input: { route: string; limit: number },
): Promise<
  { ok: true; identity: ProductIdentity } | { ok: false; response: Response }
> {
  const identity = await apiIdentity();
  if (!identity)
    return { ok: false, response: json({ error: "unauthorized" }, 401) };
  if (!hasSameOrigin(request))
    return { ok: false, response: json({ error: "invalid_origin" }, 403) };
  try {
    await enforceRateLimit({
      subject: `user:${identity.userId}`,
      route: input.route,
      limit: input.limit,
    });
  } catch (error) {
    if (error instanceof RateLimitError)
      return { ok: false, response: json({ error: "rate_limited" }, 429) };
    if (error instanceof RateLimitUnavailableError)
      return {
        ok: false,
        response: json({ error: "service_unavailable" }, 503),
      };
    throw error;
  }
  return { ok: true, identity };
}
