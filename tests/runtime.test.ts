import { describe, expect, it } from "vitest";
import { InMemoryCheckpointStore } from "../src/lib/runtime/checkpoints";
import { InMemoryEventJournal, reconstruct } from "../src/lib/runtime/events";
import { routeCapabilities } from "../src/lib/runtime/router";
import {
  canTransitionRun,
  canTransitionStage,
  isTerminalRunStatus,
} from "../src/lib/runtime/state-machine";
import { parseSsePackets } from "../src/lib/runtime/sse";
import { parseSseFrame, ProviderError } from "../src/lib/models/unorouter";
import { publicRuntimeErrorMessage } from "../src/lib/runtime/errors";
import { hasSameOrigin, readJsonBody } from "../src/lib/security/request";
import { rankSkills, selectSkills, type Skill } from "../src/lib/skills";

describe("runtime foundation", () => {
  it("routes compound work", () => {
    expect(routeCapabilities("research sources then implement code")).toEqual([
      "coding",
      "research",
    ]);
  });

  it("sequences and reconstructs in-memory test events", () => {
    const journal = new InMemoryEventJournal();
    journal.append({
      type: "planning",
      visibility: "user",
      summary: "Planning",
      data: { status: "planning" },
    });
    journal.append({
      type: "running",
      visibility: "user",
      summary: "Running",
      data: { status: "running" },
    });
    expect(journal.list().map((event) => event.sequence)).toEqual([1, 2]);
    expect(reconstruct(journal.list()).status).toBe("running");
  });

  it("restores the latest in-memory test checkpoint", () => {
    const store = new InMemoryCheckpointStore();
    store.save({ runId: "r", label: "one", state: { x: 1 } });
    store.save({ runId: "r", label: "two", state: { x: 2 } });
    expect(store.latest("r")?.state).toEqual({ x: 2 });
    expect(store.latest("r")?.version).toBe(2);
  });

  it("enforces valid run transitions", () => {
    expect(canTransitionRun("created", "planning")).toBe(true);
    expect(canTransitionRun("planning", "completed")).toBe(false);
    expect(isTerminalRunStatus("completed")).toBe(true);
    expect(canTransitionStage("pending", "running")).toBe(true);
    expect(canTransitionStage("completed", "running")).toBe(false);
  });

  it("bounds skill selection at eight", () => {
    const skills = Array.from({ length: 20 }, (_, index): Skill => ({
      id: String(index),
      slug: String(index),
      version: "1",
      category: "engineering",
      description: "coding skill",
      capabilities: ["coding"],
      activation: ["code"],
      risk: "low",
      requiredTools: [],
      contextCost: index + 1,
      state: "enabled",
    }));
    expect(selectSkills("code", skills, ["coding"]).length).toBe(8);
    expect(rankSkills("code", skills, ["coding"], 20).length).toBe(8);
  });

  it("parses normalized provider SSE frames", () => {
    const chunk = parseSseFrame(
      'data: {"choices":[{"delta":{"content":"hel"}}],"usage":{"prompt_tokens":3}}',
    );
    expect(chunk?.choices?.[0]?.delta?.content).toBe("hel");
    expect(parseSseFrame("data: [DONE]")).toBeNull();
    expect(() => parseSseFrame("data: not-json")).toThrow(ProviderError);
  });

  it("parses ChatHub SSE packets", () => {
    const packets = parseSsePackets(
      'data: {"kind":"delta","runId":"r","text":"hello"}\n\n',
    );
    expect(packets).toEqual([{ kind: "delta", runId: "r", text: "hello" }]);
  });

  it("enforces same-origin, bounded JSON requests", async () => {
    const request = new Request("https://osirus.test/api/runtime", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://osirus.test",
      },
      body: JSON.stringify({ objective: "hello" }),
    });
    expect(hasSameOrigin(request)).toBe(true);
    expect(await readJsonBody(request)).toEqual({
      ok: true,
      value: { objective: "hello" },
    });

    const oversized = new Request("https://osirus.test/api/runtime", {
      method: "POST",
      body: "12345",
    });
    expect(await readJsonBody(oversized, 4)).toEqual({
      ok: false,
      error: "payload_too_large",
    });
  });

  it("does not expose provider diagnostics to the user", () => {
    expect(
      publicRuntimeErrorMessage(
        new ProviderError("Bearer super-secret", "provider_error"),
      ),
    ).toBe("The run could not be completed. Please try again.");
  });
});
