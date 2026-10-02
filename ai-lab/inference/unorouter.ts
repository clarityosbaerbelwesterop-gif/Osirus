/**
 * UnoRouter OpenAI-compatible client. The key is read from the argument,
 * which callers set from UNOROUTER_API_KEY. This module never logs the key.
 */

export const DEFAULT_UNOROUTER_BASE_URL = "https://api.unorouter.com/v1";

export class UnoRouterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnoRouterError";
  }
}

export interface ChatMessage {
  readonly role: "system" | "user" | "assistant";
  readonly content: string;
}

export interface UnoRouterChatResult {
  readonly text: string;
  readonly modelId: string;
  readonly tokenUsage: { input: number; output: number };
}

export function labApiKey(env: NodeJS.ProcessEnv): string | undefined {
  const value = env.UNOROUTER_API_KEY;
  if (typeof value !== "string" || value.trim() === "") return undefined;
  return value;
}

export async function unorouterChat(input: {
  baseUrl?: string;
  apiKey: string | undefined;
  model: string;
  messages: readonly ChatMessage[];
  fetchImpl?: typeof fetch;
}): Promise<UnoRouterChatResult> {
  if (!input.apiKey) {
    throw new UnoRouterError(
      "UNOROUTER_API_KEY is not set; UnoRouter fallback fails closed",
    );
  }
  const fetchImpl = input.fetchImpl ?? fetch;
  const base = (input.baseUrl ?? DEFAULT_UNOROUTER_BASE_URL).replace(/\/$/, "");
  const response = await fetchImpl(`${base}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: input.model, messages: input.messages }),
  });
  if (!response.ok) {
    throw new UnoRouterError(
      `UnoRouter chat failed with HTTP ${response.status}`,
    );
  }
  const body = (await response.json()) as {
    model?: unknown;
    choices?: { message?: { content?: unknown } }[];
    usage?: { prompt_tokens?: unknown; completion_tokens?: unknown };
  };
  const text = body.choices?.[0]?.message?.content;
  if (typeof text !== "string")
    throw new UnoRouterError("UnoRouter response had no message content");
  return {
    text,
    modelId: typeof body.model === "string" ? body.model : input.model,
    tokenUsage: {
      input:
        typeof body.usage?.prompt_tokens === "number"
          ? body.usage.prompt_tokens
          : 0,
      output:
        typeof body.usage?.completion_tokens === "number"
          ? body.usage.completion_tokens
          : 0,
    },
  };
}
