/**
 * GitOps control plane — every outbound HTTP call lives here, behind an
 * injected `fetch`, so tests never touch the network and the call sites stay
 * auditable. Callers pass secrets from the environment; nothing here reads or
 * logs them, and error messages never echo request headers.
 */

import type { JobPayload } from "./render";

export interface FetchResponseLike {
  readonly ok: boolean;
  readonly status: number;
  text(): Promise<string>;
}
export type FetchLike = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  },
) => Promise<FetchResponseLike>;

async function requestJson(
  fetch: FetchLike,
  method: "GET" | "POST",
  url: string,
  apiKey: string,
  body?: unknown,
  timeoutMs = 60_000,
): Promise<Record<string, unknown>> {
  const res = await fetch(url, {
    method,
    headers: apiKey
      ? {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
        }
      : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  if (!res.ok)
    throw new Error(
      `${method} ${new URL(url).host} failed with HTTP ${res.status}: ${text.slice(0, 300)}`,
    );
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed))
      return parsed as Record<string, unknown>;
  } catch {
    // fall through
  }
  throw new Error(
    `${method} ${new URL(url).host} returned a non-object JSON body`,
  );
}

export interface DispatchReceipt {
  readonly providerJobId: string;
  readonly status: string;
}

/** RunPod serverless: the job runs on a scale-to-zero worker and is killed at `executionTimeout`. */
export async function dispatchRunpod(
  fetch: FetchLike,
  endpointId: string,
  apiKey: string,
  payload: JobPayload,
): Promise<DispatchReceipt> {
  if (!/^[a-z0-9]{6,64}$/i.test(endpointId))
    throw new Error("RunPod endpoint id has an unexpected shape");
  const res = await requestJson(
    fetch,
    "POST",
    `https://api.runpod.ai/v2/${endpointId}/run`,
    apiKey,
    {
      input: payload,
      policy: { executionTimeout: payload.timeoutMs },
    },
  );
  if (typeof res.id !== "string")
    throw new Error("RunPod response has no job id");
  return { providerJobId: res.id, status: String(res.status ?? "IN_QUEUE") };
}

export async function runpodStatus(
  fetch: FetchLike,
  endpointId: string,
  apiKey: string,
  jobId: string,
): Promise<string> {
  if (!/^[a-z0-9]{6,64}$/i.test(endpointId) || !/^[\w-]{1,128}$/.test(jobId))
    throw new Error("bad RunPod id");
  const res = await requestJson(
    fetch,
    "GET",
    `https://api.runpod.ai/v2/${endpointId}/status/${jobId}`,
    apiKey,
  );
  return String(res.status ?? "UNKNOWN");
}

/** Modal: a deployed web endpoint that verifies the bearer token and spawns the job function. */
export async function dispatchModal(
  fetch: FetchLike,
  url: string,
  apiKey: string,
  payload: JobPayload,
): Promise<DispatchReceipt> {
  if (!/^https:\/\/[\w.-]+\.modal\.run(\/[\w./-]*)?$/.test(url))
    throw new Error("Modal job URL must be an https://*.modal.run endpoint");
  const res = await requestJson(fetch, "POST", url, apiKey, { input: payload });
  const id = res.call_id ?? res.id;
  if (typeof id !== "string") throw new Error("Modal response has no call id");
  return { providerJobId: id, status: "SPAWNED" };
}

/** OpenAI-compatible chat completion (vLLM, TGI, most hosted APIs). */
export function openAiCompatibleChat(
  fetch: FetchLike,
  opts: {
    baseUrl: string;
    apiKey: string;
    model: string;
    temperature: number;
    maxTokens: number;
  },
): (system: string, user: string) => Promise<string> {
  const url = `${opts.baseUrl.replace(/\/+$/, "")}/chat/completions`;
  return async (system, user) => {
    const res = await requestJson(
      fetch,
      "POST",
      url,
      opts.apiKey,
      {
        model: opts.model,
        temperature: opts.temperature,
        max_tokens: opts.maxTokens,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      },
      180_000,
    );
    const choice = (
      res.choices as { message?: { content?: unknown } }[] | undefined
    )?.[0];
    if (typeof choice?.message?.content !== "string")
      throw new Error("teacher response has no message content");
    return choice.message.content;
  };
}

/**
 * Process reward model contract: POST {prompt, steps, solution} ->
 * {stepScores: number[]} with one score in [0, 1] per step.
 */
export function httpProcessRewardModel(
  fetch: FetchLike,
  opts: { url: string; apiKey: string },
): (input: {
  prompt: string;
  steps: readonly string[];
  solution: string;
}) => Promise<number[]> {
  return async (input) => {
    const res = await requestJson(
      fetch,
      "POST",
      opts.url,
      opts.apiKey,
      input,
      120_000,
    );
    const scores = res.stepScores;
    if (
      !Array.isArray(scores) ||
      scores.length !== input.steps.length ||
      !scores.every((s) => typeof s === "number" && s >= 0 && s <= 1)
    ) {
      throw new Error("PRM response must carry one score in [0, 1] per step");
    }
    return scores as number[];
  };
}

/**
 * Every string field of every row of a public Hugging Face dataset split, via
 * the datasets-server rows API. Source format: `hf-rows:<dataset>:<config>:<split>`.
 */
export async function fetchDatasetTexts(
  fetch: FetchLike,
  source: string,
  maxRows = 20_000,
): Promise<string[]> {
  const m = /^hf-rows:([\w.-]+\/[\w.-]+):([\w.-]+):([\w.-]+)$/.exec(source);
  if (!m) throw new Error(`unsupported eval source ${source}`);
  const [, dataset, config, split] = m;
  const texts: string[] = [];
  for (let offset = 0; offset < maxRows; offset += 100) {
    const q = new URLSearchParams({
      dataset,
      config,
      split,
      offset: String(offset),
      length: "100",
    });
    const res = await requestJson(
      fetch,
      "GET",
      `https://datasets-server.huggingface.co/rows?${q}`,
      "",
    );
    const rows =
      (res.rows as { row?: Record<string, unknown> }[] | undefined) ?? [];
    for (const { row } of rows) {
      texts.push(
        Object.values(row ?? {})
          .filter((v): v is string => typeof v === "string")
          .join("\n"),
      );
    }
    if (rows.length < 100) break;
  }
  if (texts.length === 0)
    throw new Error(`eval source ${source} returned no rows`);
  return texts;
}
