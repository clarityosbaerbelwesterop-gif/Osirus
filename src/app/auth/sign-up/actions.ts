"use server";

import { auth, requireAuthConfiguration } from "@/lib/auth/server";
import { redirect } from "next/navigation";
import type { AuthActionState } from "../sign-in/actions";

export async function signUpWithEmail(
  _previous: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  requireAuthConfiguration();
  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!name || !email || password.length < 8) {
    return {
      error:
        "Name, email, and a password of at least 8 characters are required.",
    };
  }

  const { error } = await auth.signUp.email({ name, email, password });
  if (error) return { error: error.message || "Account creation failed." };

  redirect("/app");
}
