"use server";

import { auth, requireAuthConfiguration } from "@/lib/auth/server";
import { redirect } from "next/navigation";
import { LEGAL_ERROR } from "@/app/legal/operator";
import { authAttemptAllowed } from "../rate";
import type { AuthActionState } from "../sign-in/actions";

export async function assertSignupLegal(input: {
  terms: boolean;
  privacy: boolean;
}): Promise<AuthActionState> {
  if (!input.terms || !input.privacy) return { error: LEGAL_ERROR };
  return null;
}

function legalAccepted(formData: FormData) {
  return (
    formData.get("acceptTerms") === "on" &&
    formData.get("acceptPrivacy") === "on"
  );
}

export async function signUpWithEmail(
  _previous: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!legalAccepted(formData)) return { error: LEGAL_ERROR };

  if (!name || !email || password.length < 8) {
    return {
      error:
        "Name, E-Mail und ein Passwort mit mindestens 8 Zeichen sind erforderlich.",
    };
  }

  requireAuthConfiguration();

  if (
    !(await authAttemptAllowed({
      route: "auth.signup",
      email,
      perAddress: 6,
      perNetwork: 12,
    }))
  ) {
    return { error: "Zu viele Registrierungen. Bitte eine Minute warten." };
  }

  const result = await auth.signUp.email({ name, email, password });
  if (result.error) {
    return {
      error:
        "Mit diesen Angaben konnte kein Konto angelegt werden. Ist die E-Mail schon registriert? Dann bitte anmelden.",
    };
  }

  const createdUser = (
    result as {
      data?: {
        user?: { id?: string; email?: string | null; name?: string | null };
      };
    }
  ).data?.user;
  if (process.env.DATABASE_URL && createdUser?.id) {
    try {
      const { ensureOsirusUser } = await import("@/lib/auth/bootstrap");
      const { recordCurrentConsent } = await import("@/lib/legal/store");
      await ensureOsirusUser({
        id: createdUser.id,
        email: createdUser.email ?? email,
        name: createdUser.name ?? name,
      });
      await recordCurrentConsent(createdUser.id);
    } catch {
      // If DB consent recording fails here, /app will redirect to /consent.
    }
  }

  redirect("/app");
}
