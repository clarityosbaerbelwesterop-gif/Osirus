// Credentials that must never appear in logs, errors or anything shown:
// provider keys, database URLs, bearer tokens and GitHub tokens (classic,
// OAuth, app and fine-grained).
const secret =
  /\b(?:sk-[A-Za-z0-9_-]{12,}|postgres(?:ql)?:\/\/[^\s]+|Bearer\s+[A-Za-z0-9._-]+|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/gi;

export function redact(value: string) {
  return value.replace(secret, "[REDACTED]");
}
