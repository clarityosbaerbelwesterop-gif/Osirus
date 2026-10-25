import "server-only";
import { queryAs } from "@/lib/db/client";
import {
  LEGAL_DOCUMENTS,
  LEGAL_VERSIONS,
  consentAllowsUse,
  type AcceptanceRow,
  type LegalDocument,
} from "./versions";

export async function legalAcceptances(userId: string) {
  return queryAs<AcceptanceRow>(
    userId,
    `select document, version
       from osirus.legal_acceptances
      where user_id = $1::uuid`,
    [userId],
  );
}

export async function consentIsCurrent(userId: string) {
  try {
    const rows = await legalAcceptances(userId);
    return consentAllowsUse(rows);
  } catch (error) {
    const code = (error as { code?: unknown })?.code;
    if (
      code === "42P01" ||
      (error instanceof Error &&
        /legal_acceptances.*does not exist/i.test(error.message))
    ) {
      return true;
    }
    throw error;
  }
}

/** Records the current text version for every required document. */
export async function recordCurrentConsent(userId: string) {
  for (const document of LEGAL_DOCUMENTS) {
    await recordConsent(userId, document, LEGAL_VERSIONS[document]);
  }
}

export async function recordConsent(
  userId: string,
  document: LegalDocument,
  version: string,
) {
  await queryAs(
    userId,
    `insert into osirus.legal_acceptances (user_id, document, version, accepted_at)
     values ($1::uuid, $2, $3, now())
     on conflict (user_id, document) do update
       set version = excluded.version,
           accepted_at = now()`,
    [userId, document, version],
  );
}
