/**
 * Structured lab logs. Secrets are redacted before the line is returned.
 * Callers may print the returned line; they must not log the raw key.
 */

export function redactSecrets(
  value: unknown,
  secrets: readonly string[] = [],
): unknown {
  if (typeof value === "string") {
    let out = value.replace(
      /Bearer\s+[A-Za-z0-9._\-~+/]+=*/g,
      "Bearer [redacted]",
    );
    for (const secret of secrets) {
      if (secret.length > 0) out = out.split(secret).join("[redacted]");
    }
    return out;
  }
  if (Array.isArray(value))
    return value.map((item) => redactSecrets(item, secrets));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value)) {
      if (/api[_-]?key|authorization|secret|token/i.test(key)) {
        out[key] = "[redacted]";
      } else {
        out[key] = redactSecrets(inner, secrets);
      }
    }
    return out;
  }
  return value;
}

export function labLog(
  event: string,
  fields: Record<string, unknown>,
  secrets: readonly string[] = [],
): string {
  const payload = redactSecrets(
    { ts: new Date().toISOString(), event, ...fields },
    secrets,
  );
  return JSON.stringify(payload);
}
