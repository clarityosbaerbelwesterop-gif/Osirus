import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  createTestDatabase,
  type TestDatabase,
  type TestIdentity,
} from "./helpers/pglite";

const holder = vi.hoisted(() => ({ db: null as TestDatabase | null }));

vi.mock("../src/lib/db/client", () => ({
  queryAs: (userId: string, text: string, params?: unknown[]) =>
    holder.db!.queryAs(userId, text, params),
  querySystem: (text: string, params?: unknown[]) =>
    holder.db!.querySystem(text, params),
  db: () => {
    throw new Error("tests never reach Neon");
  },
}));

import { createAgent, listAgents } from "../src/lib/agents/store";
import { openWorkRun } from "../src/lib/work/store";
import { recommendWork } from "../src/lib/work/recommend";
import { applyWorkSelection } from "../src/lib/work/selection";

let db: TestDatabase;
let alice: TestIdentity;
let bob: TestIdentity;

beforeAll(async () => {
  db = await createTestDatabase();
  holder.db = db;
  alice = await db.seedTenant("Alice");
  bob = await db.seedTenant("Bob");
}, 120000);

afterAll(async () => {
  await db.close();
});

describe("work and agents tenant isolation", () => {
  it("does not let one workspace read another's agents", async () => {
    const created = await createAgent({
      identity: {
        userId: alice.userId,
        organizationId: alice.organizationId,
        workspaceId: alice.workspaceId,
        workspaceName: alice.workspaceName,
      },
      name: "Ada",
      systemPrompt: "kurz",
      modelId: "glm-5.3-flash",
    });
    expect(created?.model_id).toBe("glm-5.3-flash");
    const visible = await listAgents({
      userId: bob.userId,
      organizationId: bob.organizationId,
      workspaceId: bob.workspaceId,
      workspaceName: bob.workspaceName,
    });
    expect(visible).toEqual([]);
    const stolen = await db.queryAs<{ id: string }>(
      bob.userId,
      "select id from osirus.agents where name = 'Ada'",
    );
    expect(stolen).toEqual([]);
  });

  it("stores a work run with a distinct reviewer and no model call", async () => {
    const recommendation = recommendWork("Was ist 2+2?");
    const applied = applyWorkSelection({
      recommendation,
      allowedModelIds: null,
    });
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    const opened = await openWorkRun({
      identity: {
        userId: alice.userId,
        organizationId: alice.organizationId,
        workspaceId: alice.workspaceId,
        workspaceName: alice.workspaceName,
      },
      prompt: "Was ist 2+2?",
      recommendation,
      selection: applied.selection,
    });
    const [row] = await db.queryAs<{
      exec_model: string;
      reviewer_model: string;
    }>(
      alice.userId,
      "select exec_model, reviewer_model from osirus.runs where id = $1::uuid",
      [opened.runId],
    );
    expect(row?.exec_model).not.toBe(row?.reviewer_model);
    const calls = await db.queryAs<{ id: string }>(
      alice.userId,
      "select id from osirus.model_calls where run_id = $1::uuid",
      [opened.runId],
    );
    expect(calls).toEqual([]);
    const hidden = await db.queryAs<{ id: string }>(
      bob.userId,
      "select id from osirus.runs where id = $1::uuid",
      [opened.runId],
    );
    expect(hidden).toEqual([]);
  });
});
