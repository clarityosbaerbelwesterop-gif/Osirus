"use server";

import { auth, requireAuthConfiguration } from "@/lib/auth/server";
import { env } from "@/lib/env";
import { authAttemptAllowed } from "../rate";
import type { AuthActionState } from "../sign-in/actions";

const SENT =
  "Wenn zu dieser E-Mail ein Konto existiert, ist ein Link zum Zurücksetzen unterwegs. Bitte auch im Spam-Ordner nachsehen.";

/** Sends the reset link. Always the same answer: no account enumeration. */
export async function requestReset(
  _previous: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  requireAuthConfiguration();
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  if (!email) return { error: "Bitte die E-Mail-Adresse eingeben." };
  if (
    !(await authAttemptAllowed({
      route: "auth.reset",
      email,
      perAddress: 3,
      perNetwork: 10,
    }))
  ) {
    return { error: "Zu viele Anfragen. Bitte eine Minute warten." };
  }
  const base = env.OSIRUS_PUBLIC_URL ?? "https://osirus-ai.vercel.app";
  await auth
    .requestPasswordReset({
      email,
      redirectTo: new URL("/auth/reset-password", base).toString(),
    })
    .catch(() => undefined);
  return { notice: SENT };
}
