import { describe, expect, it } from "vitest";
import { orbHues } from "../src/components/bots/bot-orb";
import { speechText } from "../src/components/bots/use-voice";
import { agentsMentioned, everyoneMentioned } from "../src/lib/agents/mentions";
import { botRole } from "../src/lib/agents/role";
import { BOT_ROLES } from "../src/lib/agents/roles";
import {
  groupSessions,
  sessionGroupFor,
} from "../src/lib/product/session-groups";
import { sessionHref } from "../src/lib/product/surfaces";

const NOW = new Date(2026, 9, 27, 21, 0, 0);
const at = (days: number, hour = 12) =>
  new Date(2026, 9, 27 - days, hour, 0, 0).toISOString();

describe("history by day", () => {
  it("groups by the reader's calendar days, not 24-hour windows", () => {
    expect(sessionGroupFor(at(0, 0), NOW)).toBe("today");
    expect(sessionGroupFor(at(1, 23), NOW)).toBe("yesterday");
    expect(sessionGroupFor(at(3), NOW)).toBe("week");
    expect(sessionGroupFor(at(12), NOW)).toBe("month");
    expect(sessionGroupFor(at(90), NOW)).toBe("older");
    expect(sessionGroupFor("not a date", NOW)).toBe("older");
  });

  it("keeps only groups with entries, newest first, order kept inside", () => {
    const groups = groupSessions(
      [
        { id: "a", updatedAt: at(0, 20) },
        { id: "b", updatedAt: at(0, 9) },
        { id: "c", updatedAt: at(40) },
      ],
      NOW,
    );
    expect(groups.map((group) => group.label)).toEqual(["Heute", "Älter"]);
    expect(groups[0].items.map((item) => item.id)).toEqual(["a", "b"]);
  });
});

describe("where a conversation opens", () => {
  it("opens a bot's thread in that bot's room and the rest on their surface", () => {
    expect(sessionHref({ id: "s", surface: "bot", botId: "b" })).toBe(
      "/app/agents/b?session=s",
    );
    expect(sessionHref({ id: "s", surface: "bot", botId: null })).toBe(
      "/app?session=s",
    );
    expect(sessionHref({ id: "s", surface: "agent" })).toBe(
      "/app/agent?session=s",
    );
    expect(sessionHref({ id: "s", surface: "coding" })).toBe(
      "/app/coding?session=s",
    );
    expect(sessionHref({ id: "s" })).toBe("/app?session=s");
  });
});

describe("bots", () => {
  it("reads the role line of every preset and none from free instructions", () => {
    expect(
      BOT_ROLES.filter((role) => role.prompt).map((role) =>
        botRole(role.prompt),
      ),
    ).toEqual([
      "Software Engineer",
      "Database Engineer",
      "Research Analyst",
      "Strategie-Berater",
      "Jurist für Verträge und Compliance",
      "Texter",
      "Kundensupport",
    ]);
    expect(botRole("Du bist ein freundlicher Bot.")).toBeNull();
    expect(botRole(null)).toBeNull();
  });

  it("@alle asks everyone; a name only that bot", () => {
    const members = [
      { id: "1", name: "Ada" },
      { id: "2", name: "Bea" },
    ];
    expect(everyoneMentioned("@alle wie starten wir?")).toBe(true);
    expect(everyoneMentioned("Hallo @all.")).toBe(true);
    expect(everyoneMentioned("email@alle.de")).toBe(false);
    expect(everyoneMentioned("@allerdings")).toBe(false);
    expect(agentsMentioned("@Ada kurz bitte", members)).toEqual([members[0]]);
  });

  it("gives every bot its own stable orb colours", () => {
    expect(orbHues("11111111-1111-4111-8111-111111111111")).toEqual(
      orbHues("11111111-1111-4111-8111-111111111111"),
    );
    expect(orbHues("a")).not.toEqual(orbHues("b"));
    for (const hue of orbHues("ada")) {
      expect(hue).toBeGreaterThanOrEqual(0);
      expect(hue).toBeLessThan(360);
    }
  });

  it("reads answers aloud without markdown, code or source marks", () => {
    expect(
      speechText(
        "## Plan\n**Erst** `npm test`, dann [Doku](https://x.y) lesen [1].\n```js\nx()\n```",
      ),
    ).toBe("Plan Erst npm test, dann Doku lesen. Codeblock.");
  });
});
