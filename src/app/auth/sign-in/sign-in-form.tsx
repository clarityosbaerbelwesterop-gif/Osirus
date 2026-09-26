"use client";

import Link from "next/link";
import { useActionState } from "react";
import { GitHubSignInButton } from "@/components/auth/github-sign-in-button";
import { OsirusMark } from "@/components/shell/osirus-mark";
import { signInWithEmail } from "./actions";

export function SignInForm({ oauthError }: { oauthError: string | null }) {
  const [state, action, pending] = useActionState(signInWithEmail, null);

  return (
    <main className="auth-page">
      <form action={action} className="auth-card">
        <p className="auth-brand">
          <OsirusMark size={24} />
          Osirus
        </p>
        <h1>Sign in</h1>
        <p className="auth-lede">Continue into your Osirus workspace.</p>
        {oauthError ? (
          <p className="form-error" role="alert">
            {oauthError}
          </p>
        ) : null}
        <label>
          Email
          <input name="email" type="email" autoComplete="email" required />
        </label>
        <label>
          Password
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
          {pending ? "Signing in…" : "Sign in"}
        </button>
        <GitHubSignInButton />
        <p className="auth-footer">
          New to Osirus? <Link href="/auth/sign-up">Create an account</Link>
        </p>
      </form>
    </main>
  );
}
