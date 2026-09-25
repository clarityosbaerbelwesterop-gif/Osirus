// Three-key UnoRouter diagnostics (M49 section 4). Run by the
// provider-diagnostics workflow with UNOROUTER_API_KEY_1/2/3 from GitHub
// secrets. Prints and writes only the allowed fields (see
// scripts/lib/provider-diagnostics.mjs). Never prints a key, an
// Authorization header, a token name or a raw response body.
import { appendFileSync, writeFileSync } from "node:fs";
import {
  freeModelIds,
  keyDifferences,
  looksLikeChallenge,
  modelIds,
  pickUsage,
  renderMarkdown,
} from "./lib/provider-diagnostics.mjs";

const API = "https://api.unorouter.com";
const labels = ["KEY_1", "KEY_2", "KEY_3"];

async function getJson(path, key) {
  try {
    const response = await fetch(`${API}${path}`, {
      headers: {
        Authorization: `Bearer ${key}`,
        Accept: "application/json",
        "User-Agent": "osirus-provider-diagnostics",
      },
      signal: AbortSignal.timeout(20_000),
    });
    const text = await response.text();
    if (looksLikeChallenge(response.headers.get("content-type"), text))
      return { status: `${response.status} (html challenge)`, body: null };
    try {
      return { status: response.status, body: JSON.parse(text) };
    } catch {
      return { status: `${response.status} (non-json)`, body: null };
    }
  } catch {
    return { status: "network_error", body: null };
  }
}

const results = [];
for (const [index, label] of labels.entries()) {
  const key = process.env[`UNOROUTER_API_KEY_${index + 1}`]?.trim();
  if (!key) {
    results.push({
      label,
      usage: { status: "not_configured", ...pickUsage(null) },
      models: {
        status: "not_configured",
        count: 0,
        freeCount: 0,
        freeModelIds: [],
      },
    });
    continue;
  }
  const usage = await getJson("/api/usage/token/", key);
  const models = await getJson("/v1/models", key);
  const free = models.status === 200 ? freeModelIds(models.body) : [];
  results.push({
    label,
    usage: {
      status: usage.status,
      ...(usage.status === 200 ? pickUsage(usage.body) : pickUsage(null)),
    },
    models: {
      status: models.status,
      count: models.status === 200 ? modelIds(models.body).length : 0,
      freeCount: free.length,
      freeModelIds: free,
    },
  });
}

const report = {
  runAt: new Date().toISOString(),
  keys: results,
  differences: keyDifferences(results),
};
const markdown = renderMarkdown(report);
writeFileSync("provider-diagnostics.json", JSON.stringify(report, null, 2));
writeFileSync("provider-diagnostics.md", markdown);
if (process.env.GITHUB_STEP_SUMMARY)
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown);
console.log(markdown);
