import { z } from "zod";
import { auth, requireAuthConfiguration } from "@/lib/auth/server";
import { bootstrapProductIdentity } from "@/lib/auth/bootstrap";
import { createRougeRuntime } from "@/lib/rouge";
import { rougeErrorMessage } from "@/lib/rouge/errors";
import type { RougeStreamEvent } from "@/lib/rouge/types";
import { hasSameOrigin, readJsonBody } from "@/lib/security/request";
import {
  enforceRateLimit,
  RateLimitError,
  RateLimitUnavailableError,
} from "@/lib/security/rate-limit";

// Rouge 1, AI mode (M57): one conversation turn in, one streamed answer out.
//
// Stateless on purpose until M61/M72: the client sends the conversation it
// shows, and nothing is stored but the rate-limit counter. The same guards
// as the agent route apply -- a signed-in session, same origin, JSON only,
// a size limit and a per-user rate limit.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_TOTAL_CHARS = 120_000;

const inputSchema = z
  .object({
    requestId: z.string().uuid(),
    messages: z
      .array(
        z.object({
          role: z.enum(["user", "assistant"]),
          content: z.string().max(20_000),
        }),
      )
      .min(1)
      .max(40),
    effort: z.enum(["auto", "quick", "standard", "deep", "ultra"]).optional(),
  })
  .refine(
    (input) =>
      input.messages.reduce(
        (sum, message) => sum + message.content.length,
        0,
      ) <= MAX_TOTAL_CHARS,
    { message: "conversation_too_long" },
  );

export async function POST(request: Request) {
  requireAuthConfiguration();
  const { data: session } = await auth.getSession();
  if (!session?.user) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!hasSameOrigin(request)) {
    return Response.json({ error: "invalid_origin" }, { status: 403 });
  }
  if (
    !request.headers
      .get("content-type")
      ?.toLowerCase()
      .startsWith("application/json")
  ) {
    return Response.json({ error: "unsupported_media_type" }, { status: 415 });
  }
  const body = await readJsonBody(request);
  if (!body.ok) {
    return Response.json(
      { error: body.error },
      { status: body.error === "payload_too_large" ? 413 : 400 },
    );
  }
  const parsed = inputSchema.safeParse(body.value);
  if (!parsed.success) {
    return Response.json({ error: "invalid_request" }, { status: 400 });
  }

  const identity = await bootstrapProductIdentity({
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
  });
  try {
    await enforceRateLimit({
      subject: `user:${identity.userId}`,
      route: "rouge.chat",
      limit: 20,
    });
  } catch (error) {
    if (error instanceof RateLimitError) {
      return Response.json({ error: "rate_limited" }, { status: 429 });
    }
    if (error instanceof RateLimitUnavailableError) {
      return Response.json({ error: "service_unavailable" }, { status: 503 });
    }
    throw error;
  }

  // "ultra" maps to the core's most expensive reasoning level. Until plans
  // and cost ceilings exist (M74/M75) it is capped at "deep" unless the
  // operator opts in.
  const effort =
    parsed.data.effort === "ultra" && process.env.ROUGE_ALLOW_ULTRA !== "1"
      ? "deep"
      : parsed.data.effort;

  const rouge = createRougeRuntime();
  const encoder = new TextEncoder();
  const send = (
    controller: ReadableStreamDefaultController<Uint8Array>,
    event: RougeStreamEvent | { type: "error"; code: string; message: string },
  ) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const event of rouge.stream({
          requestId: parsed.data.requestId,
          messages: parsed.data.messages,
          effort,
          signal: request.signal,
        })) {
          send(controller, event);
        }
      } catch (error) {
        const code =
          typeof (error as { code?: unknown })?.code === "string"
            ? (error as { code: string }).code
            : "rouge_failed";
        send(controller, {
          type: "error",
          code,
          message: rougeErrorMessage(code),
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Rouge-Version": `${rouge.version.name} ${rouge.version.release} ${rouge.version.policy}`,
    },
  });
}
