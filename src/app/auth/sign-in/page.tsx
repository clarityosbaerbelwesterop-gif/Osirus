"use client";

import Link from "next/link";
import { useActionState } from "react";
import { GitHubSignInButton } from "@/components/auth/github-sign-in-button";
import { signInWithEmail } from "./actions";

export default function SignInPage() {
  const [state, action, pending] = useActionState(signInWithEmail, null);

  return (
    <main className="auth-page">
      <form action={action} className="auth-card">
        <p className="eyebrow">OSIRUS</p>
        <h1>Sign in</h1>
        <p className="muted">
          Continue into the authenticated agent workspace.
        </p>
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
        {state?.error ? <p className="form-error">{state.error}</p> : null}
        <button type="submit" disabled={pending}>
          {pending ? "Signing in…" : "Sign in"}
        </button>
        <GitHubSignInButton />
        <p className="muted">
          New to Osirus? <Link href="/auth/sign-up">Create an account</Link>
        </p>
      </form>
    </main>
  );
}
