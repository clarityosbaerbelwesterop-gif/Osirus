import { env, serverKeys } from "../env";
import type { ModelProvider, ModelRole, Usage } from "./provider";
const roleModel = (role: ModelRole) =>
  ({
    FAST: env.OSIRUS_MODEL_FAST,
    STRONG: env.OSIRUS_MODEL_STRONG,
    CODING: env.OSIRUS_MODEL_CODING,
    RESEARCH: env.OSIRUS_MODEL_RESEARCH,
    MATH: env.OSIRUS_MODEL_MATH,
    VERIFY: env.OSIRUS_MODEL_VERIFY,
  })[role];
export class UnoRouterProvider implements ModelProvider {
  #controllers = new Map<string, AbortController>();
  async #request(role: ModelRole, messages: unknown[], signal?: AbortSignal) {
    if (!env.UNOROUTER_BASE_URL)
      throw new Error("UNOROUTER_BASE_URL is not configured");
    const model = roleModel(role);
    if (!model) throw new Error("model_role_unconfigured");
    const keys = serverKeys();
    if (!keys.length) throw new Error("provider_key_unconfigured");
    let last: unknown;
    for (const key of keys) {
      try {
        const res = await fetch(env.UNOROUTER_BASE_URL, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${key}`,
          },
          body: JSON.stringify({ model, messages, stream: false }),
          signal,
        });
        if (res.status === 401 || res.status === 403)
          throw new Error("provider_auth");
        if (res.status === 429) {
          last = new Error("provider_rate_limit");
          continue;
        }
        if (!res.ok) {
          if (res.status >= 500) {
            last = new Error("provider_transient");
            continue;
          }
          throw new Error(`provider_http_${res.status}`);
        }
        return await res.json();
      } catch (e) {
        if (signal?.aborted) throw new Error("provider_cancelled");
        last = e;
      }
    }
    throw this.normalizeError(last);
  }
  async complete({
    role,
    messages,
    signal,
  }: {
    role: ModelRole;
    messages: unknown[];
    signal?: AbortSignal;
  }) {
    const raw = (await this.#request(role, messages, signal)) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    return {
      text: raw.choices?.[0]?.message?.content ?? "",
      usage: this.normalizeUsage(raw),
    };
  }
  async *stream(input: {
    role: ModelRole;
    messages: unknown[];
    signal?: AbortSignal;
  }) {
    yield (await this.complete(input)).text;
  }
  async structured<T>(input: {
    role: ModelRole;
    messages: unknown[];
    validate: (x: unknown) => T;
    signal?: AbortSignal;
  }) {
    const out = await this.complete(input);
    return { value: input.validate(JSON.parse(out.text)), usage: out.usage };
  }
  async capabilities() {
    return {
      roles: ["FAST", "STRONG", "CODING", "RESEARCH", "MATH", "VERIFY"],
      failover: true,
    };
  }
  async healthCheck() {
    return Boolean(env.UNOROUTER_BASE_URL && serverKeys().length);
  }
  async cancel(id: string) {
    this.#controllers.get(id)?.abort();
    this.#controllers.delete(id);
  }
  normalizeUsage(raw: unknown): Usage {
    const u = (
      raw as { usage?: { prompt_tokens?: number; completion_tokens?: number } }
    )?.usage;
    return {
      inputTokens: u?.prompt_tokens,
      outputTokens: u?.completion_tokens,
    };
  }
  normalizeError(e: unknown) {
    return e instanceof Error ? e : new Error("provider_unknown");
  }
}
