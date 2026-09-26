import { redirect } from "next/navigation";
import { auth, authConfigured } from "@/lib/auth/server";
import { oauthErrorMessage } from "@/lib/auth/oauth-errors";
import { SignInForm } from "./sign-in-form";

type SignInPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/** Someone who is already signed in goes straight to their workspace. */
async function signedIn() {
  if (!authConfigured) return false;
  try {
    const { data } = await auth.getSession();
    return Boolean(data?.user);
  } catch {
    return false;
  }
}

export default async function SignInPage({ searchParams }: SignInPageProps) {
  const params = await searchParams;
  const oauthError = oauthErrorMessage(params.error);
  if (!oauthError && (await signedIn())) redirect("/app");
  return <SignInForm oauthError={oauthError} />;
}
