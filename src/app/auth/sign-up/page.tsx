"use client";

import Link from "next/link";
import { useActionState } from "react";
import { signUpWithEmail } from "./actions";

export default function SignUpPage() {
  const [state, action, pending] = useActionState(signUpWithEmail, null);

  return (
    <main className="auth-page">
      <form action={action} className="auth-card">
        <p className="eyebrow">OSIRUS</p>
        <h1>Create account</h1>
        <p className="muted">
          Your personal workspace is provisioned after first sign-in.
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
        {state?.error ? <p className="form-error">{state.error}</p> : null}
        <button type="submit" disabled={pending}>
          {pending ? "Creating…" : "Create account"}
        </button>
        <p className="muted">
          Already registered? <Link href="/auth/sign-in">Sign in</Link>
        </p>
      </form>
    </main>
  );
}
