import { afterEach, describe, expect, it, vi } from "vitest";

const endpoint = "https://api.unorouter.example/v1/chat/completions";

async function configuredProvider() {
  vi.resetModules();
  vi.stubEnv("UNOROUTER_BASE_URL", endpoint);
  vi.stubEnv("UNOROUTER_API_KEY_1", "test-key-one");
  vi.stubEnv("UNOROUTER_API_KEY_2", "test-key-two");
  vi.stubEnv("OSIRUS_MODEL_STRONG", "grok-4.6");
  vi.stubEnv("OSIRUS_REASONING_EFFORT", "high");
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
      model: "grok-4.6",
      reasoning_effort: "high",
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

  it("waits out a rate limit on the same key when the provider says how long", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          '{"error":{"message":"Too many requests. retry in 1s."}}',
          { status: 429 },
        ),
      )
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
          requestId: "rate-limit-wait",
          role: "STRONG",
          messages: [],
        }),
      ),
    ).resolves.toEqual([{ type: "delta", text: "ok" }]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // Same key both times: waiting is honouring the limit, not evading it.
    expect(fetchMock.mock.calls[0]?.[1]?.headers.Authorization).toBe(
      fetchMock.mock.calls[1]?.[1]?.headers.Authorization,
    );
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

  it("serves an unconfigured role on the verified free model (OSIRUS-02)", async () => {
    vi.resetModules();
    vi.stubEnv("UNOROUTER_BASE_URL", endpoint);
    vi.stubEnv("UNOROUTER_API_KEY_1", "test-key-one");
    // No STRONG model configured at all (the shared helper pins grok-4.6).
    delete process.env.OSIRUS_MODEL_STRONG;
    const providerModule = await import("../src/lib/models/unorouter");
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(
          '{"choices":[{"message":{"content":"ok"}}],"usage":{"prompt_tokens":1}}',
          { status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);
    const provider = new providerModule.UnoRouterProvider();
    await expect(
      provider.complete({
        requestId: "unconfigured-role",
        role: "STRONG",
        messages: [],
      }),
    ).resolves.toMatchObject({ text: "ok" });
    const body = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string);
    expect(body.model).toBe("deepseek-v4-pro-0813:free");
    // Another model family: no provider-specific reasoning field is sent.
    expect(body.reasoning_effort).toBeUndefined();
  });

  it("falls back to the free model when the configured one has no credit (OSIRUS-02)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("insufficient credit", { status: 402 }),
      )
      .mockResolvedValueOnce(
        new Response('{"choices":[{"message":{"content":"free answer"}}]}', {
          status: 200,
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const UnoRouterProvider = await configuredProvider();
    const provider = new UnoRouterProvider();
    await expect(
      provider.complete({
        requestId: "no-credit",
        role: "STRONG",
        messages: [],
      }),
    ).resolves.toMatchObject({ text: "free answer" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string).model).toBe(
      "grok-4.6",
    );
    expect(JSON.parse(fetchMock.mock.calls[1]?.[1]?.body as string).model).toBe(
      "deepseek-v4-pro-0813:free",
    );
  });

  it("never sidesteps a rate limit with the free model", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(() => new Response("slow", { status: 429 }));
    vi.stubGlobal("fetch", fetchMock);
    const UnoRouterProvider = await configuredProvider();
    const provider = new UnoRouterProvider({ maxRateLimitWaitSeconds: 0 });
    await expect(
      provider.complete({
        requestId: "rate-limit-fallback",
        role: "STRONG",
        messages: [],
      }),
    ).rejects.toMatchObject({ code: "rate_limited" });
    // Both attempts stayed on the configured model: a rate limit is waited
    // out, not evaded by switching models.
    expect(
      fetchMock.mock.calls.every(
        (call) => JSON.parse(call?.[1]?.body as string).model === "grok-4.6",
      ),
    ).toBe(true);
  });

  it("surfaces a rejected credential instead of papering over it", async () => {
    // A fresh Response per call: the provider reads each body once.
    const fetchMock = vi
      .fn()
      .mockImplementation(() => new Response("bad key", { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);
    const UnoRouterProvider = await configuredProvider();
    const provider = new UnoRouterProvider();
    await expect(
      provider.complete({
        requestId: "bad-credential",
        role: "STRONG",
        messages: [],
      }),
    ).rejects.toMatchObject({ code: "credential_rejected" });
    // The free model was never tried: the credential is the problem, not the
    // model, and a second model on the same key cannot fix it.
    expect(
      fetchMock.mock.calls.every(
        (call) => JSON.parse(call?.[1]?.body as string).model === "grok-4.6",
      ),
    ).toBe(true);
  });
});
