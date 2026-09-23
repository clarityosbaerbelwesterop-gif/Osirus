"use client";

import Link from "next/link";
import { useActionState } from "react";
import { GitHubSignInButton } from "@/components/auth/github-sign-in-button";
import { OsirusMark } from "@/components/shell/osirus-mark";
import { signUpWithEmail } from "./actions";

export default function SignUpPage() {
  const [state, action, pending] = useActionState(signUpWithEmail, null);

  return (
    <main className="auth-page">
      <form action={action} className="auth-card">
        <p className="auth-brand">
          <OsirusMark size={24} />
          Osirus
        </p>
        <h1>Create account</h1>
        <p className="auth-lede">
          Your personal workspace is ready after your first sign-in.
        </p>
        <label>
          Name
          <input name="name" type="text" autoComplete="name" required />
        </label>
        <label>
          Email
          <input name="email" type="email" autoComplete="email" required />
        </label>
        <label>
          Password
          <input
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={8}
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
          {pending ? "Creating…" : "Create account"}
        </button>
        <GitHubSignInButton />
        <p className="auth-footer">
          Already registered? <Link href="/auth/sign-in">Sign in</Link>
        </p>
      </form>
    </main>
  );
}
