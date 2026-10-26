// Which Authorization format and model ids Bytez accepts, measured with one
// tiny chat call per format. Prints HTTP status codes, model ids and short
// response excerpts; never the key.

const key = process.env.BYTEZ_API_KEY?.trim();
if (!key) {
  console.log("BYTEZ_API_KEY is not set; nothing to diagnose.");
  process.exit(0);
}

const CHAT = "https://api.bytez.com/models/v2/openai/v1/chat/completions";
const FORMATS = {
  bearer: `Bearer ${key}`,
  key: `Key ${key}`,
  raw: key,
};
const excerpt = (text, max = 220) =>
  text.replaceAll(key, "***").replace(/\s+/g, " ").slice(0, max);

async function call(url, init) {
  try {
    const response = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(30_000),
    });
    const text = await response.text();
    // Catalog lists are searched for model ids, so keep more of them.
    return { status: response.status, body: excerpt(text, 200_000) };
  } catch (error) {
    return { status: 0, body: String(error?.message ?? error) };
  }
}

// The OpenAI-compatible endpoint with every auth format.
for (const [name, authorization] of Object.entries(FORMATS)) {
  for (const model of ["Qwen/Qwen3-4B", "qwen/qwen3-4b", "Qwen/Qwen3.8-27B"]) {
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
    console.log(
      `openai ${name} ${model}: HTTP ${chat.status} ${chat.body.slice(0, 220)}`,
    );
  }
}

// Bytez's own model endpoint: /models/v2/<model id>.
for (const [name, authorization] of Object.entries(FORMATS)) {
  for (const model of ["Qwen/Qwen3-4B", "Qwen/Qwen3.8-27B"]) {
    const native = await call(`https://api.bytez.com/models/v2/${model}`, {
      method: "POST",
      headers: {
        Authorization: authorization,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messages: [{ role: "user", content: "Antworte nur mit OK." }],
        stream: false,
        params: { max_new_tokens: 8 },
      }),
    });
    console.log(
      `native ${name} ${model}: HTTP ${native.status} ${native.body.slice(0, 220)}`,
    );
  }
}

// The catalog, in the forms its API may take.
for (const url of [
  "https://api.bytez.com/models/v2/list/models",
  "https://api.bytez.com/models/v2/list/models?task=text-generation",
  "https://api.bytez.com/models/v2/list/models?task=chat",
  "https://api.bytez.com/models/v2/openai/v1/models",
]) {
  const list = await call(url, { headers: { Authorization: FORMATS.key } });
  const qwen = list.body.match(/Qwen\/Qwen3\.8[\w.-]*/gi) ?? [];
  console.log(
    `list ${url.replace("https://api.bytez.com", "")}: HTTP ${list.status} ${qwen.length ? `Qwen 3.8: ${[...new Set(qwen)].join(", ")}` : list.body.slice(0, 100)}`,
  );
}
