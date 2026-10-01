# OSIRUS — Legal Status (Phase I, 2026-10-01)

Scope: German/EU compliance for the Osirus service operated by ClarityCompassAI (Bärbel Westerop, 47447 Moers). This document is bookkeeping, not legal advice; the operator should have counsel review the pages before removing the DRAFT banners.

## 1. Deliverable status

| Deliverable                                                            | State          | Notes                                                                    |
| ---------------------------------------------------------------------- | -------------- | ------------------------------------------------------------------------ |
| `/legal/impressum`                                                     | DRAFT (filled) | Operator identity filled; unknown fields carry `[[OPERATOR: …]]` markers |
| `/legal/privacy`                                                       | DRAFT (filled) | Full GDPR structure; cookie inventory matches code (test-enforced)       |
| `/legal/terms`                                                         | DRAFT (filled) | Standard German-law liability/termination structure; counsel review      |
| Footer links (landing + legal layout)                                  | DONE           | All three pages reachable ≤ 2 clicks; regression-tested                  |
| Cookie consent banner                                                  | NOT NEEDED     | Only strictly-necessary / requested storage exists (§ 25 Abs. 2 TDDDG)   |
| `docs/PRIVACY_DATA_FLOW.md`                                            | DONE           | Verified against code and Neon catalog                                   |
| Tests (`tests/legal-pages.test.ts`, `tests/preference-cookie.test.ts`) | DONE           | Statute references, cookie inventory, Secure flag behaviour              |

## 2. Legal references verified for this revision (2026-10-01)

- **§ 5 DDG** (Digitale-Dienste-Gesetz) replaced § 5 TMG on 2024-05-14; required disclosures unchanged. Pages cite DDG only.
- **EU ODR platform discontinued 2025-07-20** (Regulation (EU) 2024/3228) — link duty removed; pages deliberately do not reference it. The § 36 VSBG statement remains required.
- **TTDSG renamed TDDDG** (2024-05-14); § 25 unchanged. Strictly-necessary and expressly requested storage needs no consent (§ 25 Abs. 2); no non-essential storage exists in the product.
- **EinwV** (consent-management ordinance, in force since April 2025) — irrelevant while no consent UI exists.
- **Vercel Inc.** self-declares EU-U.S. DPF certification (vercel.com/legal/privacy-notice).
- **Neon, LLC** is covered by the Databricks, Inc. EU-U.S. DPF certification (neon.com/privacy-policy). Database region is eu-central-1.

## 3. Operator inputs required before the DRAFT banners come down

1. Street and house number (ladungsfähige Anschrift) — Impressum + privacy controller.
2. Second fast contact channel (usually telephone) — required by § 5 DDG in addition to email.
3. Confirm `clarityos.baerbelwesterop@gmail.com` as the public contact address (drafted from the repository identity, not yet confirmed).
4. Legal form (e.g. Einzelunternehmen) — do not publish a form that is not registered.
5. Commercial register entry (court + number) or the statement that none exists.
6. VAT ID (§ 27a UStG) and/or Wirtschafts-Identifikationsnummer (§ 139c AO), or the statement that none has been issued.
7. § 36 VSBG participation statement (drafted default: neither obliged nor willing).
8. § 18 Abs. 2 MStV: confirm whether editorial responsibility applies (product site — likely not).
9. Concrete retention periods + account-deletion procedure + backup expiry (privacy § 5).
10. Name the configured UnoRouter model provider + region (privacy § 3–4) and its transfer basis.
11. Confirm DPAs (Art. 28 GDPR) are in place with Vercel, Neon/Databricks, and the model provider; record SCC fallback where applicable.
12. Counsel review of Terms § 9 (liability) and § 10 (venue for business users).

## 4. Standing rules

- Never invent register, tax, or contact data — marker or nothing.
- Any new non-essential cookie/storage/tracker requires a consent gate **before** it ships (§ 25 Abs. 1 TDDDG).
- If a payment provider is added, privacy § 3 and Terms § 7 must be updated in the same change.
