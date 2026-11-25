import { describe, expect, it, vi } from "vitest";
import type { GatewayModel } from "../src/lib/gateway/models";

// Photos in every surface (2026-11-25): an image is read once at upload by
// a model that sees images. Free models first, the plan's lock respected, a
// model that only apologises ("I can't see images") never counts as read.

vi.mock("server-only", () => ({}));
vi.mock("../src/lib/db/client", () => ({
  queryAs: async () => [],
  querySystem: async () => [],
}));

const { blindReading, readImage, visionCandidates } =
  await import("../src/lib/attachments/vision");
const { activityLabel } = await import("../src/lib/ui/labels");

function model(ref: string, free: boolean, rank: number): GatewayModel {
  const [provider, ...rest] = ref.split(":");
  return {
    ref,
    provider: provider as GatewayModel["provider"],
    providerLabel: provider!,
    id: rest.join(":"),
    name: rest.join(":"),
    vendor: "",
    free,
    reasoning: false,
    contextLength: null,
    inputPerMillionUsd: null,
    outputPerMillionUsd: null,
    rank,
  } as GatewayModel;
}

const MODELS = [
  model("kunya:gemini-3.1-pro", false, 32),
  model("nvidia:nvidia/nemotron-3-ultra-550b-a55b", true, 26),
  model("nvidia:nvidia/nemotron-3.5-super-vl-120b-a12b", true, 35),
  model("kunya:claude-sonnet-5-5", false, 10),
  model("unorouter:gemini-3.1-flash-lite:free", true, 40),
];
const identity = { userId: "u", organizationId: "o", workspaceId: "w" };
const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

describe("the models that read a photo", () => {
  it("are the ones that see images, free first, within the plan", () => {
    expect(visionCandidates(MODELS, () => true).map((m) => m.ref)).toEqual([
      "nvidia:nvidia/nemotron-3.5-super-vl-120b-a12b",
      "unorouter:gemini-3.1-flash-lite:free",
      "kunya:claude-sonnet-5-5",
      "kunya:gemini-3.1-pro",
    ]);
    // The free plan's lock: free models only.
    expect(visionCandidates(MODELS, (m) => m.free).map((m) => m.ref)).toEqual([
      "nvidia:nvidia/nemotron-3.5-super-vl-120b-a12b",
      "unorouter:gemini-3.1-flash-lite:free",
    ]);
  });
});

describe("a reading that saw no image", () => {
  it("is never taken for the photo's content", () => {
    for (const text of [
      // Production 2026-11-25, a router that dropped the picture:
      "Kein Bild angehängt. Bitte lade die Rechnung hoch, damit ich die Nummer lesen kann.",
      "I'm sorry, but I can't see images.",
      "I don't see any image attached to your message.",
      "There is no image provided. Please upload the image.",
      "Leider kann ich das Bild nicht öffnen.",
      "Es wurde kein Bild übermittelt.",
    ])
      expect(blindReading(text), text).toBe(true);
    for (const text of [
      "Text im Bild: RECHNUNG 4711\nEine Rechnung auf weißem Papier.",
      "Sichtbarer Text: keiner. Das Foto zeigt einen Hund auf einer Wiese.",
      "| Monat | Umsatz |\n| Jan | 100 |\nEin Balkendiagramm mit zwei Achsen.",
      "Text: Man kann das Bild in zwei Hälften teilen. Ein Poster mit Anleitung.",
    ])
      expect(blindReading(text), text).toBe(false);
  });
});

describe("reading a photo", () => {
  it("skips a model that only apologises and keeps the one that read it", async () => {
    const tried: string[] = [];
    const complete = vi.fn(
      async (options: { ref: string; messages: unknown }) => {
        tried.push(options.ref);
        const sent = JSON.stringify(options.messages);
        expect(sent).toContain('"type":"image_url"');
        expect(sent).toContain("data:image/png;base64,");
        return options.ref.includes("nemotron")
          ? {
              text: "I'm sorry, but I can't see images.",
              reasoning: "",
              usage: {},
            }
          : {
              text: "Text im Bild: RECHNUNG 4711\nEine Rechnung auf weißem Papier.",
              reasoning: "",
              usage: {},
            };
      },
    );
    const reading = await readImage({
      identity,
      bytes: png,
      mediaType: "image/png",
      models: MODELS,
      allowed: (m) => m.free,
      complete: complete as never,
    });
    expect(tried).toEqual([
      "nvidia:nvidia/nemotron-3.5-super-vl-120b-a12b",
      "unorouter:gemini-3.1-flash-lite:free",
    ]);
    expect(reading).toEqual({
      text: "Text im Bild: RECHNUNG 4711\nEine Rechnung auf weißem Papier.",
      model: "unorouter:gemini-3.1-flash-lite:free",
    });
  });

  it("returns nothing when no model could read it", async () => {
    const reading = await readImage({
      identity,
      bytes: png,
      mediaType: "image/png",
      models: MODELS,
      allowed: () => true,
      complete: (async () => {
        throw Object.assign(new Error("busy"), { code: "rate_limited" });
      }) as never,
    });
    expect(reading).toBeNull();
  });
});

describe("the run feed in German", () => {
  it("names attachment reads and failed steps in German", () => {
    expect(activityLabel("Read 3 relevant part(s) of the attached files")).toBe(
      "3 passende Stellen der Anhänge gelesen",
    );
    expect(activityLabel("Read 1 relevant part(s) of the attached files")).toBe(
      "1 passende Stelle der Anhänge gelesen",
    );
    expect(activityLabel("This step could not be finished")).toBe(
      "Dieser Schritt konnte nicht abgeschlossen werden",
    );
  });
});
