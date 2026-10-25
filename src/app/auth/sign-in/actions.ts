"use server";

import { auth, requireAuthConfiguration } from "@/lib/auth/server";
import { enforceRateLimit, RateLimitError } from "@/lib/security/rate-limit";
import { redirect } from "next/navigation";

export type AuthActionState = { error: string } | null;

export async function signInWithEmail(
  _previous: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  requireAuthConfiguration();
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) return { error: "Email and password are required." };

  if (process.env.DATABASE_URL) {
    try {
      await enforceRateLimit({
        subject: `auth.signin:${email.slice(0, 120)}`,
        route: "auth.signin",
        limit: 10,
      });
    } catch (error) {
      if (error instanceof RateLimitError) {
        return { error: "Too many sign-in attempts. Please wait a minute." };
      }
    }
  }

  const { error } = await auth.signIn.email({ email, password });
  // Uniform error message to prevent account-enumeration oracle (RT2-09).
  if (error) return { error: "Invalid email or password." };

  redirect("/app");
}
