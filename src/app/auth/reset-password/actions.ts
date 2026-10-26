"use server";

import { redirect } from "next/navigation";
import { auth, requireAuthConfiguration } from "@/lib/auth/server";
import type { AuthActionState } from "../sign-in/actions";

/** Sets the new password with the token from the e-mailed link. */
export async function resetPassword(
  _previous: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  requireAuthConfiguration();
  const token = String(formData.get("token") ?? "");
  const password = String(formData.get("password") ?? "");
  const repeat = String(formData.get("repeat") ?? "");
  if (!token)
    return {
      error: "Der Link ist ungültig. Bitte einen neuen anfordern.",
    };
  if (password.length < 8)
    return { error: "Das Passwort braucht mindestens 8 Zeichen." };
  if (password !== repeat)
    return { error: "Die beiden Passwörter stimmen nicht überein." };
  const result = await auth
    .resetPassword({ newPassword: password, token })
    .catch(() => ({ error: { message: "failed" } }));
  if (result && "error" in result && result.error) {
    return {
      error:
        "Der Link ist abgelaufen oder wurde schon benutzt. Bitte einen neuen anfordern.",
    };
  }
  redirect("/auth/sign-in?reset=1");
}
