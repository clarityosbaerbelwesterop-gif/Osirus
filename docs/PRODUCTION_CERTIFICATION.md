# OSIRUS — Production Certification

Date: 2026-10-02 · Ref: `main` (Phase F `cc2cf091` → Phase I `4e5a57ed` → Landing/SEO `b8beb87b`) · Method: full-tree audit, real-Postgres test suite (PGlite), production Neon catalog inspection, provider documentation. Every row cites verifiable evidence; nothing is asserted from intent.

## Verdict

**READY FOR SOFT LAUNCH — conditioned on the operator items below.** No open HIGH or MEDIUM code-level findings. Two launch gates remain, both in the operator's hands, neither requiring code changes.

## Scorecard

| #   | Category                      | Verdict         | Evidence                                                                                                                                                                                                                                                |
| --- | ----------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Build & type safety           | PASS            | `tsc --noEmit` clean; prettier + eslint clean; **985 tests passing** (vitest, real Postgres via PGlite)                                                                                                                                                 |
| 2   | Security (code + DB + CI)     | PASS*           | Phase F: AUTH-1/2/3/4, CONN-1, DB-2, DB-4 CLOSED with regression tests; DB-1 documented residual (no in-Postgres fix exists); CI hardening patch ready for operator (`docs/security/ci-workflow-hardening.patch`). \* = residual documented, not hidden |
| 3   | Tenant isolation (RLS)        | PASS            | 81 tables RLS ENABLED+FORCED, 180 policies, `osirus_app` NOLOGIN/NOBYPASSRLS per-transaction; migration 020 production-verified: 0 PUBLIC EXECUTE on all 18 functions                                                                                   |
| 4   | Auth                          | PASS            | Fail-closed cookie secret; OAuth errors surfaced (no silent loop); proxy guard; auth routes noindex                                                                                                                                                     |
| 5   | Legal (Impressum/Privacy/AGB) | CONDITIONAL     | Pages filled with verified 2026 statute references (§ 5 DDG, TDDDG, ODR removal); DRAFT banners stay until the 12 operator inputs in `docs/LEGAL_STATUS.md` § 3 are supplied and counsel reviews                                                        |
| 6   | Privacy & cookies             | PASS            | No analytics/tracking; strictly-necessary + requested cookies only (§ 25 Abs. 2 TDDDG) — no banner needed; inventory enforced by tests; `docs/PRIVACY_DATA_FLOW.md` verified against code                                                               |
| 7   | SEO / public surface          | PASS            | robots.ts (public indexable, app/api/auth/internal excluded), sitemap.ts, metadataBase + OpenGraph + Twitter, JSON-LD SoftwareApplication, favicon; landing page animated, reduced-motion safe, zero JS animation runtime                               |
| 8   | Reliability                   | PASS            | Durable DAG runtime, lease fencing (SKIP LOCKED + lease tokens), idempotent requestIds, checkpoint+budget in one transaction, scheduler tick + client poll recovery                                                                                     |
| 9   | Billing                       | N/A (by design) | No payment provider integrated; Terms and privacy state this truthfully. Do not enable checkout without a dedicated phase (entitlement races, webhook verification, legal updates in the same change)                                                   |
| 10  | Observability                 | PARTIAL         | Structured JSON console logger only; no APM/OTel. Acceptable for soft launch; add APM before scaling                                                                                                                                                    |

## Launch gates (operator, no code required)

1. **Legal inputs** — the 12 items in `docs/LEGAL_STATUS.md` § 3 (address, phone, legal form, register, VAT/W-IdNr, VSBG statement, retention, provider naming, DPAs, counsel review). Then remove the DRAFT banners.
2. **CI patch** — apply `docs/security/ci-workflow-hardening.patch` with a `workflow`-scoped token; create repo variables `VERCEL_TEAM_ID` + `VERCEL_PROJECT_ID`.
3. **Repo hygiene** — branch protection on `main` (require PR + CI), auto-delete merged branches, delete the 34+ merged dead branches.
4. **Neon console** — IP allowlist, protected branch, raise PITR retention (DB-3/DB-5).
5. **OG image** (optional) — static 1200×630 social card; deferred (no binary assets could be pushed via the available tooling).

## Freeze rule (Phase N)

`main` is frozen for feature work from this certification forward. Allowed without re-certification: operator legal-field fill-ins, the CI patch application, branch/label hygiene, documentation. Anything else reopens certification.
