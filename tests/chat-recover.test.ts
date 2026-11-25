import { describe, expect, it, vi } from "vitest";

// Reported 2026-11-25: Safari in the background dropped the connection, the
// answer was cut off and the quota still paid. The server now writes the
// answer to its end; the page fetches it on return (savedAnswer), and only
// the stop button ends an answer (watchChatStop).

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db/client", () => ({
  queryAs: async () => [],
  querySystem: async () => [],
}));

const { savedAnswer } =
  await import("../src/components/agents-chat/agents-chat");
const { watchChatStop } = await import("../src/lib/gateway/threads");

const at = (iso: string) => Date.parse(iso);

describe("the saved answer to a turn", () => {
  const thread = [
    { id: "u1", role: "user" as const, content: "Erste Frage" },
    {
      id: "a1",
      role: "assistant" as const,
      content: "Erste Antwort",
      createdAt: "2026-11-25T10:00:05.000Z",
    },
    { id: "u2", role: "user" as const, content: "Zweite Frage" },
  ];

  it("is the answer after the question, once it is saved", () => {
    const turn = {
      sent: "Zweite Frage",
      regenerate: false,
      sentAt: at("2026-11-25T10:01:00.000Z"),
    };
    expect(savedAnswer(thread, turn)).toBeNull();
    const done = [
      ...thread,
      {
        id: "a2",
        role: "assistant" as const,
        content: "Zweite Antwort",
        createdAt: "2026-11-25T10:01:09.000Z",
      },
    ];
    expect(savedAnswer(done, turn)?.id).toBe("a2");
  });

  it("is never the old answer when an answer is written again", () => {
    const turn = {
      sent: "Erste Frage",
      regenerate: true,
      sentAt: at("2026-11-25T10:02:00.000Z"),
    };
    const before = thread.slice(0, 2);
    expect(savedAnswer(before, turn)).toBeNull();
    const after = [
      ...before,
      {
        id: "a1b",
        role: "assistant" as const,
        content: "Neue Antwort",
        createdAt: "2026-11-25T10:02:07.000Z",
      },
    ];
    expect(savedAnswer(after, turn)?.id).toBe("a1b");
  });
});

describe("the stop watch", () => {
  it("never ends the answer while the page is connected", async () => {
    const page = new AbortController();
    const work = new AbortController();
    const isStopped = vi.fn(async () => true);
    const watch = watchChatStop({
      disconnected: page.signal,
      work,
      isStopped,
      everyMs: 5,
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(isStopped).not.toHaveBeenCalled();
    expect(work.signal.aborted).toBe(false);
    watch.stop();
  });

  it("lets the answer run on after a dropped connection", async () => {
    const page = new AbortController();
    const work = new AbortController();
    const isStopped = vi.fn(async () => false);
    const watch = watchChatStop({
      disconnected: page.signal,
      work,
      isStopped,
      everyMs: 5,
    });
    page.abort();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(isStopped).toHaveBeenCalled();
    expect(work.signal.aborted).toBe(false);
    watch.stop();
  });

  it("ends the answer when the stop button was pressed", async () => {
    const page = new AbortController();
    const work = new AbortController();
    let pressed = false;
    const watch = watchChatStop({
      disconnected: page.signal,
      work,
      isStopped: async () => pressed,
      everyMs: 5,
    });
    page.abort();
    await new Promise((resolve) => setTimeout(resolve, 15));
    expect(work.signal.aborted).toBe(false);
    pressed = true;
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(work.signal.aborted).toBe(true);
    watch.stop();
  });
});
