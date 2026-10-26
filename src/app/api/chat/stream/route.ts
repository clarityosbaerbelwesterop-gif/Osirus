import { z } from "zod";
import { publicRuntimeErrorMessage } from "@/lib/runtime/errors";
import { serializeQuota } from "@/lib/billing/quota";
import { getAgent } from "@/lib/agents/store";
import { modelAccessFor, modelAllowed } from "@/lib/gateway/access";
import { answerCacheKey, cachedAnswer, storeAnswer } from "@/lib/gateway/cache";
import {
  listGatewayModels,
  pickDefaultModel,
  resolveGatewayModel,
  type GatewayModel,
} from "@/lib/gateway/models";
import { chatErrorMessage, chatSystemPrompt } from "@/lib/gateway/prompt";
import { estimateTokens, recordGatewayCall } from "@/lib/gateway/usage";
import {
  streamGateway,
  type GatewayMessage,
  type GatewayUsage,
} from "@/lib/gateway/stream";
import {
  chatContext,
  chatSession,
  createChatSession,
  saveChatMessage,
} from "@/lib/gateway/threads";
import { loadProductSession } from "@/lib/product/session";
import { hasSameOrigin, readJsonBody } from "@/lib/security/request";
import {
  enforceRateLimit,
  RateLimitError,
  RateLimitUnavailableError,
} from "@/lib/security/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

const schema = z.object({
  sessionId: z.string().uuid().nullable().optional(),
  message: z.string().trim().min(1).max(32_000),
  model: z.string().trim().min(3).max(240).nullable().optional(),
  botId: z.string().uuid().nullable().optional(),
  regenerate: z.boolean().optional().default(false),
});

function json(body: unknown, status: number, headers?: Record<string, string>) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store", ...headers },
  });
}

const encoder = new TextEncoder();
const frame = (event: Record<string, unknown>) =>
  encoder.encode(`data: ${JSON.stringify(event)}\n\n`);

function refusalCode(error: unknown) {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  if (error instanceof DOMException && error.name === "AbortError")
    return "cancelled";
  return "provider_error";
}

function retryAfterOf(error: unknown) {
  if (error && typeof error === "object" && "retryAfterMs" in error) {
    const value = (error as { retryAfterMs?: unknown }).retryAfterMs;
    if (typeof value === "number" && value > 0) return value;
  }
  return undefined;
}

export async function POST(request: Request) {
  const session = await loadProductSession();
  if (!session) return json({ error: "unauthorized" }, 401);
  if (!hasSameOrigin(request)) return json({ error: "invalid_origin" }, 403);
  if (
    !request.headers
      .get("content-type")
      ?.toLowerCase()
      .startsWith("application/json")
  ) {
    return json({ error: "unsupported_media_type" }, 415);
  }
  const raw = await readJsonBody(request, 96 * 1024);
  if (!raw.ok) {
    return json(
      { error: raw.error },
      raw.error === "payload_too_large" ? 413 : 400,
    );
  }
  const parsed = schema.safeParse(raw.value);
  if (!parsed.success) return json({ error: "invalid_request" }, 400);
  const body = parsed.data;
  const { identity, user } = session;

  try {
    await enforceRateLimit({
      subject: `user:${identity.userId}`,
      route: "chat.stream",
      limit: 30,
    });
  } catch (error) {
    if (error instanceof RateLimitError)
      return json({ error: "rate_limited" }, 429);
    if (error instanceof RateLimitUnavailableError) {
      return json({ error: "service_unavailable" }, 503);
    }
    throw error;
  }

  const [access, listing, bot, existing] = await Promise.all([
    modelAccessFor({
      userId: identity.userId,
      email: user.email,
      emailVerified: user.emailVerified,
    }),
    listGatewayModels(),
    body.botId
      ? getAgent(identity, body.botId).catch(() => null)
      : Promise.resolve(null),
    body.sessionId
      ? chatSession(identity, body.sessionId)
      : Promise.resolve(null),
  ]);

  if (access.quota && !access.quota.allowed) {
    const noPlan = access.quota.reason === "no_subscription";
    return json(
      {
        error: noPlan ? "subscription_required" : "quota_exhausted",
        message: publicRuntimeErrorMessage({
          code: noPlan ? "subscription_required" : "quota_exhausted",
        }),
        quota: serializeQuota(access.quota),
      },
      noPlan ? 402 : 429,
      noPlan
        ? undefined
        : {
            "Retry-After": String(Math.ceil(access.quota.retryAfterMs / 1000)),
          },
    );
  }
  if (body.sessionId && !existing) {
    return json(
      {
        error: "session_not_found",
        message: "Dieser Chat existiert nicht mehr.",
      },
      404,
    );
  }
  if (body.botId && (!bot || bot.status !== "active")) {
    return json(
      {
        error: "bot_unavailable",
        message: "Dieser Bot ist pausiert oder gelöscht.",
      },
      409,
    );
  }

  const allowed = listing.models.filter((model) => modelAllowed(model, access));
  const requestedRef = body.model ?? (bot ? bot.model_id : null);
  let model: GatewayModel | null = null;
  if (requestedRef) {
    model = await resolveGatewayModel(requestedRef);
    if (model && !modelAllowed(model, access)) {
      return json(
        {
          error: "model_not_in_plan",
          message:
            "Dieses Modell ist im Free-Plan nicht enthalten. Wähle ein kostenloses Modell oder ein Abo.",
        },
        403,
      );
    }
  }
  model ??= pickDefaultModel(allowed);
  if (!model) {
    return json(
      {
        error: "no_models",
        message:
          listing.providers.length === 0
            ? "In dieser Umgebung ist kein Modell-Key hinterlegt (OPENROUTER_API_KEY, NVIDIA_API_KEY oder UNOROUTER_API_KEY_1)."
            : "Die Modell-Anbieter antworten gerade nicht. Bitte gleich noch einmal versuchen.",
      },
      503,
    );
  }

  const sessionId =
    existing?.id ??
    (await createChatSession(identity, {
      title: body.message.replace(/\s+/g, " ").slice(0, 80),
      surface: bot ? "bot" : "ai",
    }));
  const history = existing ? await chatContext(identity, sessionId, 24) : [];
  // Regenerate answers the last user turn again; the turn itself is not repeated.
  const lastUser = [...history].reverse().find((turn) => turn.role === "user");
  const reuseTurn = body.regenerate && lastUser?.content === body.message;
  const context = reuseTurn
    ? history.slice(0, history.lastIndexOf(lastUser!))
    : history;
  if (!reuseTurn) {
    await saveChatMessage(identity, {
      sessionId,
      role: "user",
      content: body.message,
      metadata: { surface: "ai", model: model.ref, botId: bot?.id ?? null },
    });
  }

  const messages: GatewayMessage[] = [
    {
      role: "system",
      content: chatSystemPrompt({
        botName: bot?.name ?? null,
        botPrompt: bot?.system_prompt ?? null,
        modelName: model.name,
      }),
    },
    ...context,
    { role: "user", content: body.message },
  ];
  const cacheKey = answerCacheKey({
    scope: identity.workspaceId,
    ref: model.ref,
    messages,
  });
  const hit = body.regenerate ? null : cachedAnswer(cacheKey);
  const chosen = model;
  const started = Date.now();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let text = "";
      let reasoning = "";
      let usage: GatewayUsage = {};
      let closed = false;
      const send = (event: Record<string, unknown>) => {
        if (closed) return;
        try {
          controller.enqueue(frame(event));
        } catch {
          closed = true;
        }
      };
      send({
        type: "start",
        sessionId,
        title:
          existing?.title ?? body.message.replace(/\s+/g, " ").slice(0, 80),
        created: !existing,
        model: {
          ref: chosen.ref,
          name: chosen.name,
          providerLabel: chosen.providerLabel,
        },
        cached: Boolean(hit),
      });

      let status: "completed" | "failed" | "cancelled" = "completed";
      let errorCode: string | null = null;
      try {
        if (hit) {
          reasoning = hit.reasoning;
          text = hit.text;
          if (reasoning) send({ type: "reasoning", text: reasoning });
          // Delivered in slices so it reads like an answer, not a jump.
          for (let index = 0; index < text.length; index += 48) {
            send({ type: "text", text: text.slice(index, index + 48) });
          }
        } else {
          for await (const event of streamGateway({
            ref: chosen.ref,
            messages,
            signal: request.signal,
          })) {
            if (event.type === "text") {
              text += event.text;
              send(event);
            } else if (event.type === "reasoning") {
              reasoning += event.text;
              send(event);
            } else {
              usage = { ...usage, ...event.usage };
            }
          }
          if (!text.trim()) {
            throw Object.assign(
              new Error("The model returned an empty answer"),
              {
                code: "empty_response",
              },
            );
          }
          storeAnswer(cacheKey, { text, reasoning });
        }
      } catch (error) {
        errorCode = refusalCode(error);
        status =
          request.signal.aborted || errorCode === "cancelled"
            ? "cancelled"
            : "failed";
        if (status === "failed") {
          send({
            type: "error",
            code: errorCode,
            message: chatErrorMessage(errorCode, chosen),
            retryAfterMs: retryAfterOf(error),
          });
        }
      }

      usage = {
        inputTokens:
          usage.inputTokens ??
          estimateTokens(
            messages
              .map((m) => (typeof m.content === "string" ? m.content : ""))
              .join("\n"),
          ),
        outputTokens: usage.outputTokens ?? estimateTokens(text + reasoning),
        costUsd: usage.costUsd,
      };
      const latencyMs = Date.now() - started;
      let messageId: string | null = null;
      try {
        if (text.trim()) {
          const saved = await saveChatMessage(identity, {
            sessionId,
            role: "assistant",
            content: text,
            metadata: {
              surface: "ai",
              model: chosen.ref,
              modelName: chosen.name,
              provider: chosen.provider,
              botId: bot?.id ?? null,
              reasoning: reasoning ? reasoning.slice(0, 60_000) : null,
              partial: status !== "completed",
              latencyMs,
              cached: Boolean(hit),
            },
          });
          messageId = saved.id;
        }
        await recordGatewayCall({
          identity,
          model: chosen,
          surface: "ai",
          sessionId,
          status,
          usage,
          latencyMs,
          errorCode,
          cached: Boolean(hit),
        });
      } catch (error) {
        console.error("chat.stream persist failed", error);
      }
      if (status === "completed") {
        send({
          type: "done",
          messageId,
          latencyMs,
          usage: {
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
          },
        });
      }
      if (!closed) {
        closed = true;
        try {
          controller.close();
        } catch {
          // client gone
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
