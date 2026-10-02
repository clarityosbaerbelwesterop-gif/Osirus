/**
 * UnoRouter OpenAI-compatible client.
 * Keys come from the per-request pool (see key-pool.ts). This module never
 * logs a key and does not keep a shared cursor or a mutex around one call.
 * 429 and 5xx try the next key in that request's pool, with backoff.
 * A single key backs off and retries 429 a bounded number of times.
 * Same path for every selected program. Not a measured quality score.
 */

import { labKeyPool } from "./key-pool";

export const DEFAULT_UNOROUTER_BASE_URL = "https://api.unorouter.com/v1";

/** How many lab fallbacks may be in flight at once. Not a one-call lock. */
export const FALLBACK_ADMISSION = 256;

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
  readonly keyAttempts: number;
}

let active = 0;
const waiters: Array<() => void> = [];

function acquire(): Promise<void> {
  if (active < FALLBACK_ADMISSION) {
    active += 1;
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    waiters.push(() => {
      active += 1;
      resolve();
    });
  });
}

function release(): void {
  active -= 1;
  const wake = waiters.shift();
  if (wake) wake();
}

export function labApiKey(env: NodeJS.ProcessEnv): string | undefined {
  return labKeyPool(env)[0];
}

function backoffMs(attempt: number): number {
  return Math.min(200, 25 * 2 ** attempt);
}

/**
 * Extra attempts on HTTP 429 when this request has only one key.
 * A pool with another key still rotates instead. This is not a lock
 * around one in-flight call, and it is not a live benchmark.
 */
export const SAME_KEY_429_RETRIES = 3;

function retryable(status: number): boolean {
  return status === 429 || status >= 500;
}

export async function unorouterChat(input: {
  baseUrl?: string;
  apiKey?: string;
  apiKeys?: readonly string[];
  model: string;
  messages: readonly ChatMessage[];
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}): Promise<UnoRouterChatResult> {
  const keys =
    input.apiKeys ??
    (input.apiKey && input.apiKey.trim() ? [input.apiKey.trim()] : []);
  if (!keys.length) {
    throw new UnoRouterError(
      "UNOROUTER_API_KEY is not set; UnoRouter fallback fails closed",
    );
  }
  const fetchImpl = input.fetchImpl ?? fetch;
  const sleep =
    input.sleep ??
    ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const base = (input.baseUrl ?? DEFAULT_UNOROUTER_BASE_URL).replace(/\/$/, "");
  await acquire();
  try {
    let lastStatus = 0;
    for (let index = 0; index < keys.length; index += 1) {
      const apiKey = keys[index]!;
      let sameKeyTries = 0;
      while (true) {
        const response = await fetchImpl(`${base}/chat/completions`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: input.model,
            messages: input.messages,
          }),
        });
        if (response.ok) {
          const body = (await response.json()) as {
            model?: unknown;
            choices?: { message?: { content?: unknown } }[];
            usage?: { prompt_tokens?: unknown; completion_tokens?: unknown };
          };
          const text = body.choices?.[0]?.message?.content;
          if (typeof text !== "string") {
            throw new UnoRouterError(
              "UnoRouter response had no message content",
            );
          }
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
            keyAttempts: index + 1,
          };
        }
        lastStatus = response.status;
        const moreKeys = index < keys.length - 1;
        if (
          response.status === 429 &&
          !moreKeys &&
          sameKeyTries < SAME_KEY_429_RETRIES
        ) {
          sameKeyTries += 1;
          await sleep(backoffMs(sameKeyTries - 1));
          continue;
        }
        const again = retryable(response.status) && moreKeys;
        if (!again) {
          throw new UnoRouterError(
            `UnoRouter chat failed with HTTP ${response.status}`,
          );
        }
        await sleep(backoffMs(index));
        break;
      }
    }
    throw new UnoRouterError(`UnoRouter chat failed with HTTP ${lastStatus}`);
  } finally {
    release();
  }
}

export { labKeyPool };
