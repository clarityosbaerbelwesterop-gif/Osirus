import { describe, expect, it } from "vitest";
import { openedSurfaceThread } from "../src/lib/product/surface-thread";
import {
  draftAfterSurfaceChange,
  sessionsForSurface,
} from "../src/lib/product/surfaces";

describe("per-surface threads", () => {
  it("does not show another surface's thread or invent one", () => {
    const coding = {
      surface: "coding" as const,
      messages: [{ id: "1", role: "user" as const, content: "fix the bug" }],
    };
    expect(
      openedSurfaceThread({
        surface: "ai",
        state: coding,
        hasSession: true,
      }),
    ).toBeNull();
    expect(
      openedSurfaceThread({
        surface: "bot",
        state: null,
        hasSession: false,
      }),
    ).toBeNull();
    expect(
      openedSurfaceThread({
        surface: "bot",
        state: { surface: "bot", messages: coding.messages },
        hasSession: true,
      })?.messages,
    ).toHaveLength(1);
  });

  it("lists only that surface's titles", () => {
    const rows = [
      { title: "Chat one", surface: "ai" },
      { title: "Agent one", surface: "agent" },
      { title: "Bot one", surface: "bot" },
      { title: "Code one", surface: "coding" },
      { title: "Old chat", surface: null },
    ];
    expect(sessionsForSurface(rows, "bot").map((row) => row.title)).toEqual([
      "Bot one",
    ]);
    expect(sessionsForSurface(rows, "coding").map((row) => row.title)).toEqual([
      "Code one",
    ]);
    expect(sessionsForSurface(rows, null).map((row) => row.title)).toEqual([
      "Chat one",
      "Old chat",
    ]);
  });

  it("clears the composer when leaving Chat for Coding", () => {
    expect(draftAfterSurfaceChange("ai", "coding", "hello")).toBe("");
    expect(draftAfterSurfaceChange("ai", "ai", "hello")).toBe("hello");
  });
});
