// Credentials that must never appear in logs, errors or anything shown.
//
// Audit 2026-11-17: the list covered OpenAI-style keys, database URLs,
// bearer tokens and GitHub tokens only. Provider errors and tool output can
// echo any key Osirus or a connected service uses, so the formats of every
// service Osirus talks to are listed, plus the generic shapes (JWTs, private
// key blocks, credentials in URLs and key=value pairs).

const PATTERNS: RegExp[] = [
  // Private key blocks (PEM), whole.
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  // Database and other URLs with a password: scheme://user:password@host
  /\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:[^\s@/]+@[^\s]+/gi,
  /\bpostgres(?:ql)?:\/\/[^\s]+/gi,
  // Authorization headers.
  /\b(?:Bearer|Basic|token)\s+[A-Za-z0-9._~+/=-]{8,}/gi,
  // OpenAI, Anthropic, OpenRouter and similar (sk-...), Stripe secret,
  // restricted and webhook keys (sk_live_, rk_test_, whsec_).
  /\bsk-[A-Za-z0-9_-]{12,}/g,
  /\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{10,}/g,
  /\bwhsec_[A-Za-z0-9]{10,}/g,
  // GitHub (classic, OAuth, app, refresh, fine-grained).
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  // NVIDIA, Neon, Supabase, Resend, Hugging Face, Slack, Google, AWS.
  /\bnvapi-[A-Za-z0-9_-]{20,}/g,
  /\bnapi_[A-Za-z0-9]{20,}/g,
  /\bsbp_[A-Za-z0-9]{20,}/g,
  /\bre_[A-Za-z0-9]{8,}_[A-Za-z0-9]{8,}/g,
  /\bhf_[A-Za-z0-9]{20,}/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
  /\bAIza[0-9A-Za-z_-]{30,}/g,
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
  // JSON Web Tokens (header.payload.signature).
  /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
];

// key=value and "key": "value" pairs whose name says secret, in query
// strings, form bodies, JSON and logs. The name stays, the value goes.
const NAMED =
  /((?:api[_-]?key|apikey|access[_-]?token|refresh[_-]?token|auth[_-]?token|token|secret|client[_-]?secret|password|passwd|pwd)["']?\s*[:=]\s*["']?)([^\s"'&,;}]{4,})/gi;

export function redact(value: string) {
  let out = value;
  for (const pattern of PATTERNS) out = out.replace(pattern, "[REDACTED]");
  return out.replace(NAMED, "$1[REDACTED]");
}
