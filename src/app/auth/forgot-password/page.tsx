import type { Metadata } from "next";
import { ForgotPasswordForm } from "./form";

export const metadata: Metadata = { title: "Passwort vergessen" };

export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string | string[] }>;
}) {
  const { email } = await searchParams;
  const value = typeof email === "string" ? email.trim() : "";
  return (
    <ForgotPasswordForm
      email={
        value.length <= 320 && /^[^\s@]+@[^\s@]+$/.test(value) ? value : null
      }
    />
  );
}
