# OSIRUS — Privacy Data Flow (verified against code and infrastructure)

Date: 2026-10-01 · Method: code reads (main @ `cc2cf091` + Phase I branch), Neon catalog inspection (`super-voice-69875601`), provider documentation. Nothing here is assumed; each flow cites the code or config that implements it.

## 1. Controller

Bärbel Westerop — ClarityCompassAI (project: Osirus), 47447 Moers, Germany. Public contact address: pending operator confirmation (see `docs/LEGAL_STATUS.md`).

## 2. System map

```
browser ──TLS──▶ Vercel (edge + serverless functions, sandbox execution)
                    │
                    ├─▶ Neon Postgres, eu-central-1 (all app data)
                    │     schemas: osirus (53 tables), osirus_intel (28)
                    │     RLS ENABLED+FORCED on all 81 app tables
                    │
                    ├─▶ Neon Auth (Better Auth) — sessions, GitHub OAuth
                    │
                    ├─▶ UnoRouter — OpenAI-compatible model inference
                    │     (provider + region configured by operator via env)
                    │
                    └─▶ GitHub API — only when user connects GitHub
```

## 3. Data categories and flows

| Category                                                                                    | Where stored / processed                                                                        | Code evidence                                                |
| ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Account (email, name, auth identity)                                                        | Neon `neon_auth` schema (managed)                                                               | `src/lib/auth/server.ts`                                     |
| Workspace content (sessions, runs, plans, checkpoints, events)                              | Neon `osirus` schema                                                                            | `src/lib/db/client.ts`, migrations 000–020                   |
| Memory (episodic/semantic/procedural/strategic)                                             | Neon `osirus` schema, workspace-scoped, lexical (no vectors)                                    | `src/lib/memory/*`                                           |
| Attachments (≤ 10 MB, magic-byte sniffed, parsed to text)                                   | Neon (parsed chunks)                                                                            | `src/lib/attachments/*` (tests: `tests/attachments.test.ts`) |
| Model call records (role, model, tokens, latency, error class — **no prompts/completions**) | Neon `osirus` schema                                                                            | verified in Phase E audit                                    |
| Security events (approvals, denials, rate limits)                                           | Neon, append-only for the app role                                                              | Phase E audit; RLS policies                                  |
| Connector credentials (GitHub/Vercel/Neon/Supabase PATs)                                    | AES-256-GCM envelope-sealed (`v1.…`) in `credential_reference`; key from `OSIRUS_CONNECTOR_KEY` | `src/lib/connectors/crypto.ts`                               |
| Model prompts/completions                                                                   | Sent to the configured inference provider at call time; not written to call records             | `src/lib/models/unorouter.ts`                                |

## 4. Processors and transfer basis (GDPR Ch. V)

| Processor                       | Role                      | Region / entity                   | Transfer basis                                                     |
| ------------------------------- | ------------------------- | --------------------------------- | ------------------------------------------------------------------ |
| Neon, LLC (Databricks, Inc.)    | Database + auth           | EU (eu-central-1) / US parent     | EU-U.S. DPF — Neon, LLC is covered by the Databricks certification |
| Vercel Inc.                     | Hosting + sandbox         | US / global edge                  | EU-U.S. DPF (Vercel self-declares certification)                   |
| GitHub (Microsoft)              | OAuth + connector, opt-in | US                                | EU-U.S. DPF                                                        |
| UnoRouter (configured provider) | Model inference           | `[[OPERATOR: provider + region]]` | `[[OPERATOR: DPF/SCC per provider]]`                               |

Operator TODOs are tracked in `docs/LEGAL_STATUS.md`.

## 5. Cookies and device storage (§ 25 TDDDG)

| Cookie / storage          | Purpose                       | Lifetime | Flags                         | Basis                                 |
| ------------------------- | ----------------------------- | -------- | ----------------------------- | ------------------------------------- |
| Neon Auth session cookies | Sign-in session               | session  | set by Neon Auth              | § 25 Abs. 2 TDDDG (necessary)         |
| `osirus-theme`            | Colour theme, server-rendered | 1 year   | SameSite=Lax, Secure on https | § 25 Abs. 2 TDDDG (requested setting) |
| `osirus-sidebar`          | Sidebar collapsed state       | 1 year   | SameSite=Lax, Secure on https | § 25 Abs. 2 TDDDG (requested setting) |

No analytics, advertising, or tracking storage exists anywhere in the tree (verified by enumeration: single `document.cookie` write site in `src/lib/ui/preferences.ts`; no localStorage/sessionStorage usage). **No consent banner is required.** Any future non-essential storage requires prior consent (§ 25 Abs. 1 TDDDG) — do not add analytics without a consent gate.

## 6. What the product deliberately does NOT do

- No plaintext credentials in the database (envelope-sealed references only).
- No prompts/completions in model call records.
- No email sending (in-app notifications only) — no email processor.
- No vector search / embedding pipeline — memory is lexical JSONB.
- No analytics, A/B testing, or advertising SDKs.

## 7. Retention

Workspace content lives while the account exists. Concrete retention periods, the account-deletion procedure, and backup expiry are operator inputs (tracked in `docs/LEGAL_STATUS.md`).
