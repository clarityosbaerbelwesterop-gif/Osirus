const secret =
  /\b(?:sk-[A-Za-z0-9_-]{12,}|postgres(?:ql)?:\/\/[^\s]+|Bearer\s+[A-Za-z0-9._-]+)\b/gi;
export function redact(value: string) {
  return value.replace(secret, "[REDACTED]");
}
