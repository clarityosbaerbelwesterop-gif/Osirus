import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  createTestDatabase,
  type TestDatabase,
  type TestIdentity,
} from "./helpers/pglite";

const holder: { db?: TestDatabase } = {};

vi.mock("../src/lib/db/client", () => ({
  queryAs: (userId: string, text: string, params?: unknown[]) =>
    holder.db!.queryAs(userId, text, params),
  querySystem: (text: string, params?: unknown[]) =>
    holder.db!.querySystem(text, params),
  db: () => {
    throw new Error("tests never reach Neon");
  },
}));

const shares = await import("../src/lib/gateway/shares");
const threads = await import("../src/lib/gateway/threads");

let owner: TestIdentity;

beforeAll(async () => {
  holder.db = await createTestDatabase();
  owner = await holder.db.seedTenant("share-owner");
}, 120_000);

afterAll(async () => {
  await holder.db?.close();
});

async function chatWith(identity: TestIdentity, turns: string[]) {
  const sessionId = await threads.createChatSession(identity, {
    title: "Zinseszins erklärt",
    surface: "ai",
  });
  for (const [index, content] of turns.entries())
    await threads.saveChatMessage(identity, {
      sessionId,
      role: index % 2 ? "assistant" : "user",
      content,
      metadata:
        index % 2
          ? { model: "openrouter:secret/model", reasoning: "intern" }
          : {},
    });
  return sessionId;
}

describe("chat share links", () => {
  it("shows a snapshot: later messages stay private until shared again", async () => {
    const sessionId = await chatWith(owner, [
      "Was ist Zinseszins?",
      "Zinsen auf Zinsen.",
    ]);
    const share = await shares.shareChat(owner, sessionId);
    expect(share?.token).toMatch(/^[A-Za-z0-9_-]{32}$/);

    const first = await shares.sharedThread(share!.token);
    expect(first?.title).toBe("Zinseszins erklärt");
    expect(first?.messages.map((m) => m.content)).toEqual([
      "Was ist Zinseszins?",
      "Zinsen auf Zinsen.",
    ]);
    // Only questions and answers: no model, reasoning or other metadata.
    expect(JSON.stringify(first)).not.toMatch(
      /secret\/model|intern|openrouter/,
    );

    await new Promise((resolve) => setTimeout(resolve, 20));
    await threads.saveChatMessage(owner, {
      sessionId,
      role: "user",
      content: "Private Folgefrage",
      metadata: {},
    });
    expect(
      (await shares.sharedThread(share!.token))?.messages.map((m) => m.content),
    ).not.toContain("Private Folgefrage");

    // Sharing again keeps the link and includes everything so far.
    const again = await shares.shareChat(owner, sessionId);
    expect(again?.token).toBe(share!.token);
    expect(
      (await shares.sharedThread(share!.token))?.messages.map((m) => m.content),
    ).toContain("Private Folgefrage");
  }, 30_000);

  it("ends the link at once when revoked", async () => {
    const sessionId = await chatWith(owner, ["Hallo", "Hallo!"]);
    const share = await shares.shareChat(owner, sessionId);
    expect(await shares.activeShare(owner, sessionId)).toMatchObject({
      token: share!.token,
    });
    expect(await shares.revokeShare(owner, sessionId)).toBe(true);
    expect(await shares.sharedThread(share!.token)).toBeNull();
    expect(await shares.activeShare(owner, sessionId)).toBeNull();
    // A new share is a new link; the old one stays dead.
    const fresh = await shares.shareChat(owner, sessionId);
    expect(fresh?.token).not.toBe(share!.token);
    expect(await shares.sharedThread(share!.token)).toBeNull();
  }, 30_000);

  it("never shares, reads or revokes another workspace's chat", async () => {
    const sessionId = await chatWith(owner, ["Vertraulich", "Ok."]);
    const share = await shares.shareChat(owner, sessionId);
    const stranger = await holder.db!.seedTenant("share-stranger");
    expect(await shares.shareChat(stranger, sessionId)).toBeNull();
    expect(await shares.activeShare(stranger, sessionId)).toBeNull();
    expect(await shares.revokeShare(stranger, sessionId)).toBe(false);
    expect(await shares.sharedThread(share!.token)).not.toBeNull();
    // Malformed or guessed tokens find nothing.
    expect(await shares.sharedThread("short")).toBeNull();
    expect(await shares.sharedThread("x".repeat(32))).toBeNull();
  }, 30_000);
});
