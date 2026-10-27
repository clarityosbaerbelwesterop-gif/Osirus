"use client";

import type { Route } from "next";
import Link from "next/link";
import { useActionState } from "react";
import { GitHubSignInButton } from "@/components/auth/github-sign-in-button";
import { OsirusMark } from "@/components/shell/osirus-mark";
import { signInWithEmail } from "./actions";

export function SignInForm({
  oauthError,
  notice,
  email,
}: {
  oauthError: string | null;
  notice?: string | null;
  /** Prefilled from a sign-up that found an existing account. */
  email?: string | null;
}) {
  const [state, action, pending] = useActionState(signInWithEmail, null);

  return (
    <main className="auth-page">
      <form action={action} className="auth-card">
        <p className="auth-brand">
          <OsirusMark size={24} />
          Osirus
        </p>
        <h1>Anmelden</h1>
        <p className="auth-lede">Weiter in deinen Osirus-Workspace.</p>
        {notice ? (
          <p className="form-notice" role="status">
            {notice}
          </p>
        ) : null}
        {oauthError ? (
          <p className="form-error" role="alert">
            {oauthError}
          </p>
        ) : null}
        <label>
          E-Mail
          <input
            name="email"
            type="email"
            autoComplete="email"
            defaultValue={email ?? undefined}
            required
          />
        </label>
        <label>
          Passwort
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            required
          />
        </label>
        {state?.error ? (
          <p className="form-error" role="alert">
            {state.error}
          </p>
        ) : null}
        <button
          type="submit"
          className="btn btn-primary auth-submit"
          disabled={pending}
        >
          {pending ? "Anmelden…" : "Anmelden"}
        </button>
        <p className="auth-forgot">
          <Link href={"/auth/forgot-password" as Route}>
            Passwort vergessen?
          </Link>
        </p>
        <GitHubSignInButton />
        <p className="auth-footer">
          Neu bei Osirus? <Link href="/auth/sign-up">Konto erstellen</Link>
        </p>
      </form>
    </main>
  );
}
