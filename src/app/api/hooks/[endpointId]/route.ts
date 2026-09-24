import { after } from "next/server";
import { z } from "zod";
import { enforceRateLimit, RateLimitError } from "@/lib/security/rate-limit";
import {
  describeEvent,
  MAX_WEBHOOK_BYTES,
  normalizeEvent,
  verifySignature,
} from "@/lib/webhooks/verify";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// The public receiver for signed webhook deliveries. No session: the sender
// proves itself with the endpoint's signature, checked on the raw body in
// constant time before anything in it is read. An unknown endpoint and a bad
// signature get the same answer, so endpoints cannot be discovered by
// probing. A verified delivery is recorded once; its automations start as
// their creators, and a scheduler tick is requested to drive them.

const reply = (body: Record<string, unknown>, status: number) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

async function readBody(request: Request) {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_WEBHOOK_BYTES) return null;
  const buffer = await request.arrayBuffer();
  if (buffer.byteLength > MAX_WEBHOOK_BYTES) return null;
  return new TextDecoder().decode(buffer);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ endpointId: string }> },
) {
  const id = z
    .string()
    .uuid()
    .safeParse((await params).endpointId).data;
  if (!id) return reply({ error: "invalid_signature" }, 401);
  try {
    await enforceRateLimit({
      subject: `webhook:${id}`,
      route: "webhooks.deliver",
      limit: 60,
    });
  } catch (error) {
    if (error instanceof RateLimitError)
      return reply({ error: "rate_limited" }, 429);
    return reply({ error: "service_unavailable" }, 503);
  }
  const body = await readBody(request);
  if (body === null) return reply({ error: "payload_too_large" }, 413);

  const { endpointForDelivery, recordDelivery } =
    await import("@/lib/webhooks/store");
  const endpoint = await endpointForDelivery(id).catch(() => null);
  if (!endpoint) return reply({ error: "invalid_signature" }, 401);
  const verified = verifySignature({
    source: endpoint.row.source,
    secret: endpoint.secret,
    body,
    headers: request.headers,
  });
  if (!verified.ok) return reply({ error: "invalid_signature" }, 401);

  const event = normalizeEvent({
    source: endpoint.row.source,
    headers: request.headers,
    body,
  });
  if (!event) return reply({ ignored: true }, 202);
  if (event.kind === "ping") return reply({ ok: true }, 200);
  const wanted = endpoint.row.events ?? [];
  if (wanted.length && !wanted.includes(event.kind)) {
    await recordDelivery(endpoint.row, event, "ignored").catch(() => false);
    return reply({ ignored: true }, 202);
  }
  const fresh = await recordDelivery(endpoint.row, event, "triggered");
  if (!fresh) return reply({ duplicate: true }, 200);

  const { triggerWebhookAutomations } = await import("@/lib/automations/store");
  const started = await triggerWebhookAutomations({
    workspaceId: endpoint.row.workspace_id,
    endpointId: endpoint.row.id,
    event,
    description: describeEvent(event),
  }).catch(() => [] as string[]);
  if (started.length)
    after(async () => {
      const { triggerTick } =
        await import("@/lib/intelligence/production/operator");
      await triggerTick(0);
    });
  return reply({ triggered: started.length }, 202);
}
