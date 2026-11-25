import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createTestDatabase, type TestDatabase } from "./helpers/pglite";

// A photo is stored with what a model read in it, as text and chunks, so
// Chat, Bots, the Rouge Agent and Code read it like any document. Against
// the real migrations and row-level security; only the model is faked.

const holder = vi.hoisted(() => ({
  db: null as TestDatabase | null,
  reading: null as { text: string; model: string } | null,
}));

vi.mock("server-only", () => ({}));
vi.mock("../src/lib/db/client", () => ({
  queryAs: (userId: string, text: string, params?: unknown[]) =>
    holder.db!.queryAs(userId, text, params),
  querySystem: (text: string, params?: unknown[]) =>
    holder.db!.querySystem(text, params),
  db: () => {
    throw new Error("tests never reach Neon");
  },
}));
vi.mock("../src/lib/attachments/vision", () => ({
  readImage: async () => holder.reading,
}));

const { saveAttachment, retrieveAttachmentChunks } =
  await import("../src/lib/attachments/store");

let db: TestDatabase;
beforeAll(async () => {
  db = await createTestDatabase();
  holder.db = db;
}, 120_000);
afterAll(async () => {
  await db?.close();
});

// A real PNG signature, so the type comes from the bytes.
const PNG = new Uint8Array([
  137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82,
]);

describe("a photo attachment", () => {
  it("is stored with what the model read, and found by any surface", async () => {
    const tenant = await db.seedTenant("photo");
    holder.reading = {
      text: "Text im Bild: RECHNUNG 4711\nEine Rechnung auf weißem Papier.",
      model: "nvidia:nvidia/nemotron-3.5-super-vl-120b-a12b",
    };
    const saved = await saveAttachment(tenant, {
      filename: "rechnung.png",
      bytes: PNG,
    });
    expect(saved).toMatchObject({ kind: "image", status: "parsed" });
    const parts = await retrieveAttachmentChunks(tenant, {
      ids: [saved.id],
      query: "Welche Nummer hat die Rechnung?",
    });
    expect(parts.map((part) => part.content).join("\n")).toContain(
      "RECHNUNG 4711",
    );
    expect(parts[0]?.label).toBe("rechnung.png, Bild");
  });

  it("says so when no model could read it", async () => {
    const tenant = await db.seedTenant("photo-unread");
    holder.reading = null;
    const saved = await saveAttachment(tenant, {
      filename: "foto.png",
      bytes: PNG,
    });
    expect(saved).toMatchObject({ kind: "image", status: "unsupported" });
  });
});
