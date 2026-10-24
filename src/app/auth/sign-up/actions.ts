"use server";

import { auth, requireAuthConfiguration } from "@/lib/auth/server";
import { redirect } from "next/navigation";
import { LEGAL_ERROR } from "@/app/legal/operator";
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
        "Name, email, and a password of at least 8 characters are required.",
    };
  }

  requireAuthConfiguration();

  const { error } = await auth.signUp.email({ name, email, password });
  if (error) return { error: error.message || "Account creation failed." };

  redirect("/app");
}
