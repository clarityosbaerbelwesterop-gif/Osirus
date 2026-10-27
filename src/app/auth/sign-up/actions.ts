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

type SignUpError = { code?: unknown; message?: unknown; status?: unknown };

/**
 * Why Neon Auth refused an account, in words a person can act on. Only the
 * code and status are read; the address itself is never logged.
 */
export async function signUpFailure(
  error: SignUpError,
): Promise<{ message: string; exists: boolean; code: string }> {
  const code = typeof error.code === "string" ? error.code.toUpperCase() : "";
  const text = `${code} ${typeof error.message === "string" ? error.message : ""}`;
  if (/COMPROMISED|pwned|breach/i.test(text))
    return {
      code: code || "PASSWORD_COMPROMISED",
      exists: false,
      message:
        "Dieses Passwort ist aus einem bekannten Datenleck bekannt. Bitte wähle ein anderes.",
    };
  if (/PASSWORD_TOO_SHORT/i.test(text))
    return {
      code,
      exists: false,
      message: "Das Passwort ist zu kurz: mindestens 8 Zeichen.",
    };
  if (/PASSWORD_TOO_LONG/i.test(text))
    return {
      code,
      exists: false,
      message: "Das Passwort ist zu lang: höchstens 128 Zeichen.",
    };
  if (/INVALID_EMAIL/i.test(text))
    return {
      code,
      exists: false,
      message:
        "Diese E-Mail-Adresse ist ungültig. Bitte prüfe die Schreibweise.",
    };
  if (
    /ALREADY_EXISTS|already exists|already registered/i.test(text) ||
    error.status === 422
  )
    return {
      code: code || "USER_ALREADY_EXISTS",
      exists: true,
      message:
        "Für diese E-Mail gibt es schon ein Konto. Melde dich an, mit Passwort oder über GitHub, falls du dich so registriert hast. Passwort vergessen? Du kannst es zurücksetzen.",
    };
  return {
    code: code || "UNKNOWN",
    exists: false,
    message:
      "Das Konto konnte gerade nicht angelegt werden. Bitte versuche es in einer Minute erneut.",
  };
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
  const values = { name: name.slice(0, 120), email: email.slice(0, 320) };

  if (!legalAccepted(formData)) return { error: LEGAL_ERROR, values };

  if (!name || !email || password.length < 8) {
    return {
      error:
        "Name, E-Mail und ein Passwort mit mindestens 8 Zeichen sind erforderlich.",
      values,
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
    return {
      error: "Zu viele Registrierungen. Bitte eine Minute warten.",
      values,
    };
  }

  const result = await auth.signUp.email({ name, email, password });
  if (result.error) {
    const failure = await signUpFailure(result.error as SignUpError);
    console.warn(`auth.signup refused: ${failure.code}`);
    return { error: failure.message, exists: failure.exists, values };
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
