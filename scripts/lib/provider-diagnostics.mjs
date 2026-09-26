// Pure helpers for the three-key UnoRouter diagnostics (M49 section 4).
// Only the allowed fields ever leave these functions: label, HTTP status,
// total_granted, total_used, total_available, unlimited_quota,
// model_limits_enabled, expires_at, model counts, free model IDs and the
// differences between keys. No key, header, token name or raw body.

export const USAGE_FIELDS = [
  "total_granted",
  "total_used",
  "total_available",
  "unlimited_quota",
  "model_limits_enabled",
  "expires_at",
];

const scalar = (value) =>
  typeof value === "number" || typeof value === "boolean" ? value : null;

/**
 * The allowed usage fields from a /api/usage/token/ body. Accepts the
 * payload at the root or under `data`; anything that is not a number or a
 * boolean is dropped, so no free text can leak through.
 */
export function pickUsage(body) {
  const source =
    body && typeof body === "object"
      ? body.data && typeof body.data === "object"
        ? body.data
        : body
      : {};
  return Object.fromEntries(
    USAGE_FIELDS.map((field) => [field, scalar(source[field])]),
  );
}

export function freeModelIds(body) {
  const data = Array.isArray(body?.data) ? body.data : [];
  return data
    .map((model) => (typeof model?.id === "string" ? model.id : null))
    .filter((id) => id && /:free$/i.test(id))
    .sort();
}

export function modelIds(body) {
  const data = Array.isArray(body?.data) ? body.data : [];
  return data
    .map((model) => (typeof model?.id === "string" ? model.id : null))
    .filter(Boolean);
}

/** A response that is an HTML challenge page rather than the API. */
export function looksLikeChallenge(contentType, text) {
  return (
    /text\/html/i.test(contentType ?? "") ||
    /<!doctype html|just a moment/i.test((text ?? "").slice(0, 200))
  );
}

/** Free-model differences between keys: IDs not listed for every key. */
export function keyDifferences(results) {
  const listed = results.filter((r) => r.models.status === 200);
  if (listed.length < 2) return [];
  const all = new Set(listed.flatMap((r) => r.models.freeModelIds));
  const differences = [];
  for (const id of [...all].sort()) {
    const missingFrom = listed
      .filter((r) => !r.models.freeModelIds.includes(id))
      .map((r) => r.label);
    if (missingFrom.length) differences.push({ model: id, missingFrom });
  }
  return differences;
}

export function renderMarkdown(report) {
  const lines = [
    `# UnoRouter key diagnostics`,
    ``,
    `Run at ${report.runAt}. Values are the allowed fields only; no key or header is recorded.`,
    ``,
    `| Key | usage HTTP | total_granted | total_used | total_available | unlimited_quota | model_limits_enabled | expires_at | models HTTP | models | free models |`,
    `| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |`,
  ];
  const cell = (value) =>
    value === null || value === undefined ? "—" : String(value);
  for (const r of report.keys) {
    lines.push(
      `| ${r.label} | ${cell(r.usage.status)} | ${cell(r.usage.total_granted)} | ${cell(r.usage.total_used)} | ${cell(r.usage.total_available)} | ${cell(r.usage.unlimited_quota)} | ${cell(r.usage.model_limits_enabled)} | ${cell(r.usage.expires_at)} | ${cell(r.models.status)} | ${cell(r.models.count)} | ${cell(r.models.freeCount)} |`,
    );
  }
  lines.push(``, `## Free model IDs per key`, ``);
  for (const r of report.keys)
    lines.push(
      `- **${r.label}**: ${r.models.freeModelIds.length ? r.models.freeModelIds.map((id) => `\`${id}\``).join(", ") : "none"}`,
    );
  lines.push(``, `## Differences between keys`, ``);
  if (!report.differences.length)
    lines.push(`No free-model differences between keys that listed models.`);
  for (const d of report.differences)
    lines.push(`- \`${d.model}\` not listed for ${d.missingFrom.join(", ")}`);
  return lines.join("\n") + "\n";
}
