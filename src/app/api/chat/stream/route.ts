import { z } from "zod";
import { publicRuntimeErrorMessage } from "@/lib/runtime/errors";
import { serializeQuota } from "@/lib/billing/quota";
import { getAgent } from "@/lib/agents/store";
import { modelAccessFor, modelAllowed } from "@/lib/gateway/access";
import { answerCacheKey, cachedAnswer, storeAnswer } from "@/lib/gateway/cache";
import {
  hideModel,
  listGatewayModels,
  modelPenalty,
  noteModelResult,
  verifiedLead,
  type GatewayModel,
} from "@/lib/gateway/models";
import {
  botTier,
  botWantsCoding,
  candidatesFor,
  classifyDifficulty,
  FALLBACK_CODES,
  higherTier,
  tierOf,
  wantsReasoning,
} from "@/lib/gateway/routing";
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
import {
  fileMaterial,
  materialPrompt,
  webMaterial,
} from "@/lib/gateway/material";
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

// No model field: outside Code, Osirus picks the model (routing.ts).
const schema = z.object({
  sessionId: z.string().uuid().nullable().optional(),
  message: z.string().trim().min(1).max(32_000),
  botId: z.string().uuid().nullable().optional(),
  regenerate: z.boolean().optional().default(false),
  /** Search the web for this message (links in it are always read). */
  web: z.boolean().optional().default(false),
  /** Files uploaded for this message (POST /api/attachments). */
  attachmentIds: z.array(z.string().uuid()).max(8).optional().default([]),
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
  if (!allowed.length) {
    return json(
      {
        error: "no_models",
        message:
          "Osirus ist gerade nicht erreichbar. Bitte gleich noch einmal versuchen.",
      },
      503,
    );
  }

  // The web lookup runs while the thread loads; it has its own time budget.
  const webPending = webMaterial({
    message: body.message,
    search: body.web,
    signal: request.signal,
  });
  const history = existing
    ? await chatContext(identity, existing.id, 24)
    : { turns: [], lastModelRef: null };
  const previous = history.lastModelRef
    ? (allowed.find((model) => model.ref === history.lastModelRef) ?? null)
    : null;
  // A bot answers on one model chosen by what it does; the plain chat on one
  // chosen by how hard the thread is. A thread keeps its model and only moves
  // up a class for a harder follow-up.
  const wanted = bot
    ? botTier(bot)
    : classifyDifficulty({
        message: body.message,
        historyChars: history.turns.reduce(
          (sum, turn) => sum + turn.content.length,
          0,
        ),
        attachments: body.attachmentIds.length,
      }).tier;
  // Reading web sources well needs at least the everyday class.
  const asked = body.web ? higherTier(wanted, "balanced") : wanted;
  const tier = previous ? higherTier(tierOf(previous), asked) : asked;
  const thinks = !bot && tier === "top" && wantsReasoning(body.message);
  // The thread's model stays first; then the models the runtime sync measured
  // answering correctly and fast (measured beats ranked); then the ranking.
  const candidates: GatewayModel[] = candidatesFor(allowed, tier, {
    coding: bot ? botWantsCoding(bot) : false,
    reasoning: thinks,
    limit: 4,
    penalty: (ref) => modelPenalty(ref),
    lead: [
      ...(previous && tierOf(previous) === tier ? [previous] : []),
      ...verifiedLead(allowed, tier, { reasoning: thinks }),
    ],
  });

  const sessionId =
    existing?.id ??
    (await createChatSession(identity, {
      title: body.message.replace(/\s+/g, " ").slice(0, 80),
      surface: bot ? "bot" : "ai",
    }));
  // Regenerate answers the last user turn again; the turn itself is not repeated.
  const turns = history.turns;
  const lastUser = [...turns].reverse().find((turn) => turn.role === "user");
  const reuseTurn = body.regenerate && lastUser?.content === body.message;
  const context = reuseTurn
    ? turns.slice(0, turns.lastIndexOf(lastUser!))
    : turns;
  const [web, files] = await Promise.all([
    webPending,
    fileMaterial(identity, {
      sessionId,
      newIds: body.attachmentIds,
      message: body.message,
    }).catch(() => ({ files: [], passages: [] })),
  ]);
  const material = materialPrompt({ web, passages: files.passages });
  if (!reuseTurn) {
    const sent = new Set(body.attachmentIds);
    await saveChatMessage(identity, {
      sessionId,
      role: "user",
      content: body.message,
      metadata: {
        surface: "ai",
        botId: bot?.id ?? null,
        tier,
        web: body.web || undefined,
        attachments: files.files.filter((file) => sent.has(file.id)),
      },
    });
  }

  const messages: GatewayMessage[] = [
    {
      role: "system",
      content:
        chatSystemPrompt({
          botName: bot?.name ?? null,
          botPrompt: bot?.system_prompt ?? null,
        }) + material.prompt,
    },
    ...context,
    { role: "user", content: body.message },
  ];
  const cacheKey = answerCacheKey({
    scope: identity.workspaceId,
    ref: candidates[0].ref,
    messages,
  });
  const hit = body.regenerate ? null : cachedAnswer(cacheKey);
  let chosen = candidates[0];
  const started = Date.now();
  const attempts: Array<{
    model: string;
    ms: number;
    firstTokenMs: number;
    code: string;
  }> = [];

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
        cached: Boolean(hit),
      });
      if (material.sources.length)
        send({ type: "sources", sources: material.sources });

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
          // Next candidate when one fails before writing anything.
          for (const [index, model] of candidates.entries()) {
            chosen = model;
            let produced = false;
            const attemptStarted = Date.now();
            let firstTokenMs = 0;
            const last = index === candidates.length - 1;
            try {
              for await (const event of streamGateway({
                ref: model.ref,
                messages,
                signal: request.signal,
                // A slow model gives way to the next one quickly; the last
                // candidate gets the full patience.
                firstByteTimeoutMs: last
                  ? 45_000
                  : model.reasoning
                    ? 20_000
                    : 12_000,
              })) {
                if (!firstTokenMs && event.type !== "usage")
                  firstTokenMs = Date.now() - attemptStarted;
                if (event.type === "text") {
                  produced = true;
                  text += event.text;
                  send(event);
                } else if (event.type === "reasoning") {
                  produced = true;
                  reasoning += event.text;
                  send(event);
                } else {
                  usage = { ...usage, ...event.usage };
                }
              }
              if (!text.trim()) {
                throw Object.assign(
                  new Error("The model returned an empty answer"),
                  { code: "empty_response" },
                );
              }
              noteModelResult(model.ref, { ok: true, firstTokenMs });
              attempts.push({
                model: model.ref,
                ms: Date.now() - attemptStarted,
                firstTokenMs,
                code: "ok",
              });
              break;
            } catch (error) {
              const code = refusalCode(error);
              attempts.push({
                model: model.ref,
                ms: Date.now() - attemptStarted,
                firstTokenMs,
                code,
              });
              if (!request.signal.aborted)
                noteModelResult(model.ref, {
                  ok: false,
                  firstTokenMs: Date.now() - attemptStarted,
                });
              const another =
                index < candidates.length - 1 &&
                !request.signal.aborted &&
                FALLBACK_CODES.has(code) &&
                (!produced || !text.trim());
              if (!another) throw error;
              if (code === "model_not_configured") hideModel(model.ref);
              if (reasoning && !text) {
                reasoning = "";
                send({ type: "reset" });
              }
              usage = {};
            }
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
            message: chatErrorMessage(errorCode),
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
      // Operator log (Vercel only, never sent to the browser): which models
      // were tried and how long each took, to tune routing from evidence.
      console.info(
        JSON.stringify({
          event: "chat.answer",
          tier,
          bot: Boolean(bot),
          cached: Boolean(hit),
          status,
          latencyMs,
          attempts,
        }),
      );
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
              tier: tierOf(chosen),
              botId: bot?.id ?? null,
              reasoning: reasoning ? reasoning.slice(0, 60_000) : null,
              partial: status !== "completed",
              latencyMs,
              cached: Boolean(hit),
              sources: material.sources.length ? material.sources : undefined,
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
