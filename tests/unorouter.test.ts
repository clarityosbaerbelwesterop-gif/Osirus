import { afterEach, describe, expect, it, vi } from "vitest";

const endpoint = "https://api.unorouter.example/v1/chat/completions";

async function configuredProvider() {
  vi.resetModules();
  vi.stubEnv("UNOROUTER_BASE_URL", endpoint);
  vi.stubEnv("UNOROUTER_API_KEY_1", "test-key-one");
  vi.stubEnv("UNOROUTER_API_KEY_2", "test-key-two");
  vi.stubEnv("OSIRUS_MODEL_STRONG", "configured-strong-model");
  const providerModule = await import("../src/lib/models/unorouter");
  return providerModule.UnoRouterProvider;
}

async function collect<T>(stream: AsyncIterable<T>) {
  const result: T[] = [];
  for await (const value of stream) result.push(value);
  return result;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("UnoRouterProvider", () => {
  it("streams split SSE frames, usage, and the configured OpenAI-compatible payload", async () => {
    const response = new Response(
      new ReadableStream({
        start(controller) {
          const encoder = new TextEncoder();
          controller.enqueue(
            encoder.encode('data: {"choices":[{"delta":{"content":"hel'),
          );
          controller.enqueue(
            encoder.encode(
              'lo"}}]}\n\ndata: {"usage":{"prompt_tokens":4,"completion_tokens":2}}\n\ndata: [DONE]\n\n',
            ),
          );
          controller.close();
        },
      }),
      { status: 200 },
    );
    const fetchMock = vi.fn().mockResolvedValue(response);
    vi.stubGlobal("fetch", fetchMock);
    const UnoRouterProvider = await configuredProvider();
    const provider = new UnoRouterProvider();

    await expect(
      collect(
        provider.stream({
          requestId: "stream-test",
          role: "STRONG",
          messages: [{ role: "user", content: "hello" }],
        }),
      ),
    ).resolves.toEqual([
      { type: "delta", text: "hello" },
      { type: "usage", usage: { inputTokens: 4, outputTokens: 2 } },
    ]);

    expect(fetchMock).toHaveBeenCalledWith(
      endpoint,
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer test-key-one",
          Accept: "text/event-stream",
        }),
      }),
    );
    expect(
      JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string),
    ).toMatchObject({
      model: "configured-strong-model",
      stream: true,
      stream_options: { include_usage: true },
    });
  });

  it("fails over after an invalid credential but never rotates on a rate limit", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("invalid", { status: 401 }))
      .mockResolvedValueOnce(
        new Response(
          'data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n',
          { status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);
    const UnoRouterProvider = await configuredProvider();
    const provider = new UnoRouterProvider();
    await expect(
      collect(
        provider.stream({
          requestId: "retry-test",
          role: "STRONG",
          messages: [],
        }),
      ),
    ).resolves.toEqual([{ type: "delta", text: "ok" }]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[1]?.headers.Authorization).toBe(
      "Bearer test-key-two",
    );

    fetchMock
      .mockReset()
      .mockResolvedValue(new Response("slow", { status: 429 }));
    await expect(
      collect(
        provider.stream({
          requestId: "rate-limit-test",
          role: "STRONG",
          messages: [],
        }),
      ),
    ).rejects.toMatchObject({ code: "rate_limited", status: 429 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("propagates a user cancellation to the provider request", async () => {
    const fetchMock = vi.fn(
      (_url: string, options: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          options.signal?.addEventListener(
            "abort",
            () => reject(options.signal?.reason),
            { once: true },
          );
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const UnoRouterProvider = await configuredProvider();
    const provider = new UnoRouterProvider();
    const iterator = provider
      .stream({
        requestId: "cancel-test",
        role: "STRONG",
        messages: [],
      })
      [Symbol.asyncIterator]();
    const pending = iterator.next();
    await Promise.resolve();
    await provider.cancel("cancel-test");

    await expect(pending).rejects.toMatchObject({ code: "cancelled" });
  });
});
