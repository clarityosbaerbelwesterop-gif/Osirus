---
name: anthropic-cybersecurity-skills
id: anthropic-cybersecurity-skills
description: Offensive/defensive red-team security auditing — SSRF, OIDC/JWT claim binding, RLS tenant isolation, CSRF, webhook replay, sandbox escape, rate limiting, and paywall enforcement.
---

# SKILL: Anthropic Cybersecurity Skills — Red-Team Audit & Hardening

## Security Audit Checklist

1. **Authentication & OIDC Claim Binding**:
   - Bind OIDC tokens strictly to single `aud`, exact `sub` (including immutable repository IDs), `repository_owner`, and `job_workflow_ref === workflow_ref`.
   - Never send OIDC bearer tokens to untrusted or foreign deployment hosts.
   - Normalize authentication error messages to prevent account enumeration and enforce per-IP/per-account rate limiting on `/api/auth/*` and sign-in/sign-up server actions.
2. **SSRF & Network Egress**:
   - Block all private/loopback/link-local IPv4 and IPv6 literals (including hex-normalized IPv4-mapped IPv6 `[::ffff:7f00:1]`, NAT64, 6to4, Unique Local, Teredo) at both URL check time and DNS connect time (`guardedLookup`).
3. **Webhook & Order Intake Integrity**:
   - Key webhook idempotency on cryptographic digests of the HMAC-signed payload (and signed timestamp), never on unsigned delivery headers.
   - Validate all external/runner orders against strict schemas, model allowlists, and command allowlists before instantiating providers or executing verification checks.
4. **Tenant Isolation, Paywall & Quota Enforcement**:
   - Enforce RLS via `osirus_app` on every table; eliminate TOCTOU races in entitlement/quota checks; enforce non-bypassable server-side paywall and 5h/weekly quota gates before any model or tool execution.
5. **Information Disclosure & CSP**:
   - Redact internal details from anonymous `/api/readiness` probes and workspace file error responses; enforce strict CSP and request body size limits across all API routes.
