"use server";

import { auth, requireAuthConfiguration } from "@/lib/auth/server";
import { redirect } from "next/navigation";
import { authAttemptAllowed } from "../rate";

export type AuthActionState = {
  error?: string;
  notice?: string;
  /** Sign-up: the address already has an account (password or GitHub). */
  exists?: boolean;
  /** Sign-up: what was typed, so a failed attempt keeps it (never the password). */
  values?: { name: string; email: string };
} | null;

export async function signInWithEmail(
  _previous: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  requireAuthConfiguration();
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  const password = String(formData.get("password") ?? "");

  if (!email || !password)
    return { error: "E-Mail und Passwort sind erforderlich." };

  if (
    !(await authAttemptAllowed({
      route: "auth.signin",
      email,
      perAddress: 10,
      perNetwork: 30,
    }))
  ) {
    return { error: "Zu viele Anmeldeversuche. Bitte eine Minute warten." };
  }

  const { error } = await auth.signIn.email({ email, password });
  // One message for every failure: no hint whether the address exists.
  if (error) return { error: "E-Mail oder Passwort ist falsch." };

  redirect("/app");
}
