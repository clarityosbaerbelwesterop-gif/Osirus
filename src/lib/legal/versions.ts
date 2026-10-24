/**
 * Versions of the legal texts a person must accept before using /app.
 * Bump a value when that text changes. Older acceptances then fail the
 * server check and the consent page is shown again.
 *
 * The pages themselves live under src/app/legal and are not edited here.
 */

export const LEGAL_DOCUMENTS = ["terms", "eula", "privacy"] as const;

export type LegalDocument = (typeof LEGAL_DOCUMENTS)[number];

export const LEGAL_VERSIONS: Record<LegalDocument, string> = {
  terms: "2026-10-24",
  eula: "2026-10-24",
  privacy: "2026-10-24",
};

export type AcceptanceRow = {
  document: string;
  version: string;
};

/** Documents that are missing or accepted against an older text version. */
export function staleLegalDocuments(rows: readonly AcceptanceRow[]) {
  return LEGAL_DOCUMENTS.filter(
    (document) =>
      !rows.some(
        (row) =>
          row.document === document && row.version === LEGAL_VERSIONS[document],
      ),
  );
}

export function consentAllowsUse(rows: readonly AcceptanceRow[]) {
  return staleLegalDocuments(rows).length === 0;
}
