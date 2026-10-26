// Which Authorization format and model ids Bytez accepts, measured with one
// tiny chat call per format. Prints HTTP status codes, model ids and short
// response excerpts; never the key.

const key = process.env.BYTEZ_API_KEY?.trim();
if (!key) {
  console.log("BYTEZ_API_KEY is not set; nothing to diagnose.");
  process.exit(0);
}

const CHAT = "https://api.bytez.com/models/v2/openai/v1/chat/completions";
const LIST = "https://api.bytez.com/models/v2/list/models";
const FORMATS = {
  bearer: `Bearer ${key}`,
  key: `Key ${key}`,
  raw: key,
};
const excerpt = (text) =>
  text.replaceAll(key, "***").replace(/\s+/g, " ").slice(0, 160);

async function call(url, init) {
  try {
    const response = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(30_000),
    });
    return { status: response.status, body: excerpt(await response.text()) };
  } catch (error) {
    return { status: 0, body: String(error?.message ?? error) };
  }
}

for (const [name, authorization] of Object.entries(FORMATS)) {
  const list = await call(`${LIST}?task=chat`, {
    headers: { Authorization: authorization },
  });
  console.log(`list  ${name}: HTTP ${list.status} ${list.body.slice(0, 80)}`);
  for (const model of ["Qwen/Qwen3-4B", "Qwen/Qwen3.8-27B"]) {
    const chat = await call(CHAT, {
      method: "POST",
      headers: {
        Authorization: authorization,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: "Antworte nur mit OK." }],
        max_tokens: 8,
        stream: false,
      }),
    });
    console.log(`chat  ${name} ${model}: HTTP ${chat.status} ${chat.body}`);
  }
}

// Qwen 3.8 ids Bytez lists for chat, with whichever format lists.
for (const authorization of Object.values(FORMATS)) {
  const response = await fetch(`${LIST}?task=chat`, {
    headers: { Authorization: authorization },
    signal: AbortSignal.timeout(30_000),
  }).catch(() => null);
  if (!response?.ok) continue;
  const data = await response.json().catch(() => null);
  const rows = Array.isArray(data) ? data : (data?.output ?? data?.data ?? []);
  const ids = rows
    .map((row) => (typeof row === "string" ? row : (row?.modelId ?? row?.id)))
    .filter((id) => typeof id === "string" && /qwen3\.8/i.test(id));
  console.log(`Qwen 3.8 chat models listed: ${ids.join(", ") || "none"}`);
  break;
}
