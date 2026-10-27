import { describe, expect, it } from "vitest";
import { recollectionPrompt } from "@/lib/agents/recollection";

describe("bot recollection", () => {
  it("is empty without earlier conversations", () => {
    expect(recollectionPrompt("Ada", [])).toBeNull();
  });

  it("groups turns by conversation and names the speakers", () => {
    const prompt = recollectionPrompt("Ada", [
      {
        sessionTitle: "Q3-Plan",
        role: "user",
        content: "Ich mag kurze Antworten.",
      },
      { sessionTitle: "Q3-Plan", role: "assistant", content: "Notiert." },
      { sessionTitle: "Pitch", role: "user", content: "Deck  für\nFreitag" },
    ])!;
    expect(prompt).toContain("Dein Gedächtnis");
    expect(prompt).toContain(
      "[Q3-Plan]\nPerson: Ich mag kurze Antworten.\nAda: Notiert.",
    );
    expect(prompt).toContain("[Pitch]\nPerson: Deck für Freitag");
    expect(prompt).toContain("erfinde nichts dazu");
  });

  it("caps each turn and the whole block, keeping the newest", () => {
    const long = "x".repeat(900);
    const turns = Array.from({ length: 16 }, (_, i) => ({
      sessionTitle: "Lang",
      role: "user" as const,
      content: `${i === 15 ? "NEUESTE " : ""}${long}`,
    }));
    const prompt = recollectionPrompt("Ada", turns)!;
    const body = prompt.slice(
      prompt.indexOf("\n", prompt.indexOf("Dein Gedächtnis")) + 1,
    );
    expect(body.length).toBeLessThanOrEqual(4000);
    expect(body).toContain("NEUESTE");
    expect(body).not.toContain("x".repeat(401));
  });
});
