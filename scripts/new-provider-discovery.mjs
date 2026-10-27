// What the newly added model keys can do, measured with the keys themselves:
// which base URL answers, which models each lists, and whether the strongest
// of them answer a real question correctly (17 shelves x 23 boxes = 391),
// how fast, and whether streaming works. Prints status codes, model ids,
// timings and short excerpts; never a key.

const PROVIDERS = [
  {
    name: "aihubmix",
    key: process.env.AIHUBMIX_API_KEY,
    bases: ["https://aihubmix.com/v1"],
  },
  {
    name: "bai",
    key: process.env.BAI_API_KEY,
    bases: ["https://api.b.ai/v1"],
    guess: ["gpt-5.2"],
  },
  {
    name: "kunya",
    key: process.env.KUNYA_API_KEY,
    bases: ["https://kunya.ai/api/v1", "https://api.kunya.ai/v1"],
  },
  {
    name: "shortapi",
    key: process.env.SHORTAPI_API_KEY,
    bases: [
      "https://api.shortapi.ai/v1",
      "https://shortapi.ai/v1",
      "https://shortapi.ai/api/v1",
      "https://api.shortapi.com/v1",
    ],
  },
  {
    name: "anakin",
    key: process.env.ANAKIN_API_KEY,
    bases: ["https://api.anakin.ai/v1", "https://api.anakin.ai/v1/openai"],
  },
];

const QUESTION =
  "Ein Lager hat 17 Regale mit je 23 Kisten. Wie viele Kisten sind es insgesamt? Antworte mit der Zahl.";
const TOP =
  /(claude-(opus|sonnet)-?[4-9]|claude-[4-9]|gpt-5|gpt-6|\bo3\b|\bo4\b|gemini-(2\.5|3)[\w.-]*pro|gemini-3|grok-4|grok-5|kimi-k[2-9]|glm-5|glm-4\.[6-9]|deepseek-(v3|r1|v4)|qwen3[\w.-]*(max|235b|coder)|llama-4|nemotron)/i;
const NOT_CHAT =
  /(image|vision-only|embed|tts|whisper|audio|music|video|dall-e|midjourney|flux|sora|veo|kling|rerank|moderation|ocr|imagen|seedream|seedance|suno|speech|transcri)/i;
// Strongest first: the order the models are tried in.
const PREFER = [
  /claude-opus/i,
  /gpt-6/i,
  /gpt-5(\.\d)?(-pro)?$/i,
  /gemini-3[\w.-]*pro/i,
  /claude-sonnet/i,
  /grok-[45]/i,
  /gemini-2\.5-pro/i,
  /kimi-k[2-9]/i,
  /glm-5/i,
  /deepseek/i,
  /qwen3/i,
];

function clean(text, key, max = 200) {
  let out = String(text ?? "");
  if (key) out = out.replaceAll(key, "***");
  return out.replace(/\s+/g, " ").slice(0, max);
}

async function request(url, key, init = {}, timeout = 60_000) {
  const started = Date.now();
  try {
    const response = await fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${key}`,
        "content-type": "application/json",
        ...(init.headers ?? {}),
      },
      signal: AbortSignal.timeout(timeout),
    });
    const text = await response.text();
    return { status: response.status, text, ms: Date.now() - started };
  } catch (error) {
    return {
      status: 0,
      text: String(error?.message ?? error),
      ms: Date.now() - started,
    };
  }
}

function modelIds(text) {
  try {
    const body = JSON.parse(text);
    const list = Array.isArray(body)
      ? body
      : Array.isArray(body?.data)
        ? body.data
        : Array.isArray(body?.models)
          ? body.models
          : [];
    return {
      ids: list
        .map((m) =>
          typeof m === "string" ? m : (m?.id ?? m?.name ?? m?.model),
        )
        .filter((id) => typeof id === "string"),
      sample:
        list[0] && typeof list[0] === "object" ? Object.keys(list[0]) : [],
      types: list.map((m) => (typeof m === "object" ? m?.type : null)),
    };
  } catch {
    return { ids: [], sample: [], types: [] };
  }
}

function pickCandidates(ids, limit = 5) {
  const chat = ids.filter((id) => TOP.test(id) && !NOT_CHAT.test(id));
  const ordered = [];
  for (const pattern of PREFER) {
    for (const id of chat
      .filter((id) => pattern.test(id))
      .sort()
      .reverse()) {
      if (!ordered.includes(id)) ordered.push(id);
    }
  }
  for (const id of chat) if (!ordered.includes(id)) ordered.push(id);
  // One per family first, so five candidates cover five families.
  const family = (id) =>
    (id.match(PREFER.find((p) => p.test(id)) ?? /.*/) ?? [id])[0].toLowerCase();
  const seen = new Set();
  const spread = [];
  for (const id of ordered) {
    const f = family(id);
    if (seen.has(f)) continue;
    seen.add(f);
    spread.push(id);
  }
  return [...spread, ...ordered.filter((id) => !spread.includes(id))].slice(
    0,
    limit,
  );
}

async function ask(base, key, model) {
  const r = await request(`${base}/chat/completions`, key, {
    method: "POST",
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: QUESTION }],
      max_tokens: 400,
      stream: false,
    }),
  });
  let answer = "";
  let usage = null;
  try {
    const body = JSON.parse(r.text);
    answer = body?.choices?.[0]?.message?.content ?? "";
    usage = body?.usage ?? null;
  } catch {}
  const correct = /\b391\b/.test(answer);
  return { ...r, answer, usage, correct };
}

async function streamTest(base, key, model) {
  const started = Date.now();
  try {
    const response = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: "Sag Hallo in einem Satz." }],
        max_tokens: 60,
        stream: true,
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok || !response.body)
      return `HTTP ${response.status} ${clean(await response.text(), key, 120)}`;
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let first = 0;
    let frames = 0;
    let text = "";
    let buffer = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (data === "[DONE]") continue;
        try {
          const delta = JSON.parse(data)?.choices?.[0]?.delta?.content ?? "";
          if (delta && !first) first = Date.now() - started;
          text += delta;
          frames += 1;
        } catch {}
      }
    }
    return `SSE ok, ${frames} frames, first token ${first} ms, total ${Date.now() - started} ms: "${clean(text, key, 80)}"`;
  } catch (error) {
    return `stream error ${clean(error?.message ?? error, key, 120)}`;
  }
}

const summary = [];
for (const provider of PROVIDERS) {
  const { name, key } = provider;
  console.log(`\n=== ${name} ===`);
  if (!key?.trim()) {
    console.log("no key in this run");
    summary.push(`${name}: no key`);
    continue;
  }
  let base = null;
  let ids = [];
  for (const candidate of provider.bases) {
    const r = await request(`${candidate}/models`, key, {}, 30_000);
    const parsed = modelIds(r.text);
    console.log(
      `models ${candidate}: HTTP ${r.status} in ${r.ms} ms, ${parsed.ids.length} ids${parsed.sample.length ? `, fields ${parsed.sample.slice(0, 12).join("/")}` : ""}${parsed.ids.length ? "" : `: ${clean(r.text, key, 160)}`}`,
    );
    if (r.status === 200 && parsed.ids.length) {
      base = candidate;
      ids = parsed.ids;
      const types = [...new Set(parsed.types.filter(Boolean))];
      if (types.length) console.log(`types: ${types.join(", ")}`);
      break;
    }
  }
  if (!base) {
    // No list: is the key accepted at all? One chat call with a guessed model.
    for (const candidate of provider.bases) {
      for (const model of provider.guess ?? ["gpt-4o-mini"]) {
        const r = await ask(candidate, key, model);
        console.log(
          `chat ${candidate} ${model}: HTTP ${r.status} in ${r.ms} ms ${r.correct ? "CORRECT" : clean(r.answer || r.text, key, 160)}`,
        );
        if (r.status === 200) base = candidate;
      }
      if (base) break;
    }
    if (!base) {
      summary.push(`${name}: no working base URL`);
      continue;
    }
  }
  const top = ids.filter((id) => TOP.test(id) && !NOT_CHAT.test(id));
  console.log(
    `base ${base}; ${ids.length} models, ${top.length} top-class chat models`,
  );
  console.log(`top: ${top.slice(0, 60).join(", ")}`);
  const candidates = ids.length ? pickCandidates(ids) : (provider.guess ?? []);
  const passed = [];
  for (const model of candidates) {
    const r = await ask(base, key, model);
    const verdict =
      r.status === 200 && r.correct && r.ms <= 30_000 ? "PASS" : "FAIL";
    console.log(
      `${verdict} ${model}: HTTP ${r.status} ${r.ms} ms ${r.correct ? "answered 391" : clean(r.answer || r.text, key, 160)}${r.usage ? ` usage ${JSON.stringify(r.usage).slice(0, 120)}` : ""}`,
    );
    if (verdict === "PASS") passed.push({ model, ms: r.ms });
  }
  if (passed.length) {
    const fastest = [...passed].sort((a, b) => a.ms - b.ms)[0];
    console.log(
      `stream ${fastest.model}: ${await streamTest(base, key, fastest.model)}`,
    );
  }
  summary.push(
    `${name}: base ${base}, ${ids.length} models, passed ${passed.map((p) => `${p.model} (${p.ms} ms)`).join(", ") || "none"}`,
  );
}

console.log("\n=== summary ===");
for (const line of summary) console.log(line);
