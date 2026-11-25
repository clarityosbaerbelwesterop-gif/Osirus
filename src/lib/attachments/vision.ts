import "server-only";
import type { ProductIdentity } from "../auth/bootstrap";
import { modelAccessFor, modelAllowed } from "../gateway/access";
import { listGatewayModels, type GatewayModel } from "../gateway/models";
import { completeGateway } from "../gateway/stream";
import { recordGatewayCall } from "../gateway/usage";

// Photos in every surface (owner's request 2026-11-25: Chat, Code, Rouge
// Agent, Bots). An image is read once, at upload, by a model that sees
// images: all visible text word for word, then what the picture shows. The
// result is stored as the attachment's text, so every surface that reads
// attachments (chat context, the runtime's retrieval) reads the photo too,
// whatever model answers later.

type Identity = { userId: string; organizationId: string; workspaceId: string };

/** Model families that take images (OpenAI-style image_url parts). */
const SEES_IMAGES =
  /(^|[\/:._-])(vl|vision)([._-]|$)|gemini|gpt-4o|gpt-4\.1|gpt-5|gpt-6|claude|grok-4|pixtral|llava|qwen[\w.-]*vl|llama-4|nemotron[\w.-]*-vl/i;

/**
 * A model that answered without seeing the image: it apologises, says
 * there is none, or asks for it. Production 2026-11-25: a router passed the
 * text but not the picture, the model wrote "Kein Bild angehängt. Bitte lade
 * die Rechnung hoch", and that was stored as the photo's content.
 */
const BLIND = [
  /(can(?:not|'t)|unable to|not able to)\s+(see|view|process|read|access|analy[sz]e|open)\s+(the\s+|this\s+|any\s+|your\s+)?(image|picture|photo|attachment)/i,
  /\b(no|not any|without an?)\s+(image|picture|photo|attachment)s?\b/i,
  /\b(don'?t|do not|didn'?t|did not)\s+(see|have|find|receive)\s+(an?|any|the)\s+(image|picture|photo|attachment)/i,
  /\b(please|kindly)\s+(upload|provide|share|attach|send)\b/i,
  /(kann|können)\s+(ich\s+|wir\s+)?(keine|kein)\s+(bild|foto)/i,
  /(kann|können)\s+(ich\s+|wir\s+)?(das|dieses|die|den)\s+(bild|foto)\w*\s+(leider\s+)?nicht\b/i,
  /\bkein(e|en)?\s+(bild|foto|anhang)\b/i,
  /\b(lade|lad|sende|schick)\w*\s+(bitte\s+)?(das|ein|die|den)\s+\w*\s*(bild|foto|anhang|rechnung|dokument|datei)/i,
];

/** Whether a reading is a model's "I see no image" instead of the image. */
export function blindReading(text: string) {
  const head = text.slice(0, 400);
  return BLIND.some((pattern) => pattern.test(head));
}

/**
 * Services that host the model themselves pass the image to it; a router
 * may drop the picture and keep the text. Among equally free models, the
 * hosts go first.
 */
const HOSTS_IMAGES = new Set(["nvidia"]);

const PROMPT = [
  "Lies dieses Bild für jemanden, der es nicht sehen kann und danach Fragen dazu stellt.",
  "1. Gib zuerst ALLEN sichtbaren Text wörtlich und vollständig wieder, in der Originalsprache und Zeile für Zeile: Überschriften, Beschriftungen, Tabellen (als Markdown-Tabelle), Code, Fehlermeldungen, Zahlen. Nichts zusammenfassen.",
  "2. Beschreibe dann auf Deutsch sachlich und genau, was zu sehen ist: Personen, Gegenstände, Diagramme mit Achsen und Werten, Bedienoberflächen, Farben, Anordnung.",
  "Gib nichts als Tatsache aus, was nicht zu sehen ist. Keine Einleitung.",
].join("\n");

export type ImageReading = { text: string; model: string };

/** The models tried for an image: free ones first, then by rank. */
export function visionCandidates(
  models: readonly GatewayModel[],
  allowed: (model: GatewayModel) => boolean,
  limit = 4,
) {
  return models
    .filter((model) => SEES_IMAGES.test(model.id) && allowed(model))
    .sort(
      (a, b) =>
        Number(b.free) - Number(a.free) ||
        Number(HOSTS_IMAGES.has(b.provider)) -
          Number(HOSTS_IMAGES.has(a.provider)) ||
        a.rank - b.rank ||
        a.ref.localeCompare(b.ref),
    )
    .slice(0, limit);
}

/**
 * Reads an image with the first model that sees it. Null when none could:
 * the attachment is then stored without text and the page says so.
 */
export async function readImage(input: {
  identity: Identity;
  bytes: Uint8Array;
  mediaType: string;
  /** Tests: a model list and a model call without the network. */
  models?: readonly GatewayModel[];
  complete?: typeof completeGateway;
  allowed?: (model: GatewayModel) => boolean;
}): Promise<ImageReading | null> {
  const models = input.models ?? (await listGatewayModels()).models;
  const allowed =
    input.allowed ??
    (await modelAccessFor({ userId: input.identity.userId, email: null })
      .then((access) => (model: GatewayModel) => modelAllowed(model, access))
      .catch(() => (model: GatewayModel) => model.free));
  const complete = input.complete ?? completeGateway;
  const url = `data:${input.mediaType};base64,${Buffer.from(input.bytes).toString("base64")}`;
  const deadline = Date.now() + 50_000;
  for (const model of visionCandidates(models, allowed)) {
    const left = deadline - Date.now();
    if (left < 5_000) break;
    const started = Date.now();
    try {
      const result = await complete({
        ref: model.ref,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: PROMPT },
              { type: "image_url", image_url: { url } },
            ],
          },
        ],
        maxTokens: 2_000,
        temperature: 0.1,
        signal: AbortSignal.timeout(Math.min(left, 40_000)),
      });
      const text = result.text.trim();
      const usable = text.length >= 20 && !blindReading(text);
      await recordGatewayCall({
        identity: input.identity as ProductIdentity,
        model,
        surface: "attachment",
        sessionId: null,
        status: usable ? "completed" : "failed",
        usage: result.usage,
        latencyMs: Date.now() - started,
        errorCode: usable ? null : "blind_model",
      }).catch(() => undefined);
      console.info(
        JSON.stringify({
          event: "attachment.vision",
          model: model.ref,
          outcome: usable ? "read" : "blind",
          chars: text.length,
          ms: Date.now() - started,
        }),
      );
      if (usable) return { text, model: model.ref };
    } catch (error) {
      console.warn(
        JSON.stringify({
          event: "attachment.vision",
          model: model.ref,
          outcome: "failed",
          code:
            (error as { code?: unknown } | null)?.code ??
            (error instanceof Error ? error.name : "unknown"),
          ms: Date.now() - started,
        }),
      );
    }
  }
  return null;
}
