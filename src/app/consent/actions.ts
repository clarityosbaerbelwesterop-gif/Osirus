"use server";

import { redirect } from "next/navigation";
import { ensureOsirusUser } from "@/lib/auth/bootstrap";
import { recordCurrentConsent } from "@/lib/legal/store";
import { loadAuthUser } from "@/lib/product/session";

export type ConsentState = { error: string } | null;

export async function acceptLegalDocuments(
  _previous: ConsentState,
  formData: FormData,
): Promise<ConsentState> {
  const terms = formData.get("terms") === "on";
  const eula = formData.get("eula") === "on";
  const privacy = formData.get("privacy") === "on";
  if (!terms || !eula || !privacy) {
    return {
      error:
        "AGB, EULA und Datenschutzerklärung müssen einzeln bestätigt werden.",
    };
  }
  const authUser = await loadAuthUser();
  if (!authUser) redirect("/auth/sign-in");
  await ensureOsirusUser(authUser);
  await recordCurrentConsent(authUser.id);
  redirect("/app");
}
