"use server";

import { auth, requireAuthConfiguration } from "@/lib/auth/server";
import { redirect } from "next/navigation";

export type AuthActionState = { error: string } | null;

export async function signInWithEmail(
  _previous: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  requireAuthConfiguration();
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) return { error: "Email and password are required." };

  const { error } = await auth.signIn.email({ email, password });
  if (error) return { error: error.message || "Sign in failed." };

  redirect("/app");
}
