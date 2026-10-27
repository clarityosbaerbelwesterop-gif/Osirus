// What this Bytez key can run, asked exactly the way Bytez's own client
// (npm bytez.js 3.x) asks: base https://api.bytez.com/models/v2/, header
// "Authorization: Key <key>", catalog lookups as GET list/models?modelId=,
// runs as POST <model id> with { input, params }. The README's own model
// (openai-community/gpt2) is the reference: when even it fails, the key or
// the account is the problem, not the model ids. Prints HTTP status codes,
// model ids and short excerpts; never the key.

const key = process.env.BYTEZ_API_KEY?.trim();
if (!key) {
  console.log("BYTEZ_API_KEY is not set; nothing to diagnose.");
  process.exit(0);
}

const BASE = "https://api.bytez.com/models/v2/";
const HEADERS = {
  lang: "javascript",
  Authorization: `Key ${key}`,
  "content-type": "application/json",
};
const excerpt = (text, max = 240) =>
  text.replaceAll(key, "***").replace(/\s+/g, " ").slice(0, max);

async function call(path, init = {}) {
  try {
    const response = await fetch(BASE + path, {
      ...init,
      headers: HEADERS,
      signal: AbortSignal.timeout(60_000),
    });
    return { status: response.status, body: excerpt(await response.text()) };
  } catch (error) {
    return { status: 0, body: String(error?.message ?? error) };
  }
}

const tasks = await call("list/tasks");
console.log(`list/tasks: HTTP ${tasks.status} ${tasks.body.slice(0, 160)}`);

const MODELS = [
  "openai-community/gpt2",
  "Qwen/Qwen3-4B",
  "Qwen/Qwen2.5-7B-Instruct",
  "Qwen/Qwen3.8-27B",
  "Qwen/Qwen3.8-27B-FP8",
  "Qwen/Qwen3.8-Flash-Next",
];

for (const model of MODELS) {
  const listed = await call(`list/models?modelId=${encodeURIComponent(model)}`);
  console.log(`catalog ${model}: HTTP ${listed.status} ${listed.body}`);
}

const chat = [{ role: "user", content: "Antworte nur mit OK." }];
for (const [model, input, params] of [
  ["openai-community/gpt2", "Hello", { max_new_tokens: 5 }],
  ["Qwen/Qwen3-4B", chat, { max_new_tokens: 8 }],
  ["Qwen/Qwen3.8-27B", chat, { max_new_tokens: 8 }],
]) {
  const run = await call(model, {
    method: "POST",
    body: JSON.stringify({ input, params }),
  });
  console.log(`run ${model}: HTTP ${run.status} ${run.body}`);
}
