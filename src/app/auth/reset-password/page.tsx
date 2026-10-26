import type { Metadata } from "next";
import { ResetPasswordForm } from "./form";

export const metadata: Metadata = { title: "Neues Passwort" };

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const token = typeof params.token === "string" ? params.token : "";
  return <ResetPasswordForm token={token.slice(0, 512)} />;
}
