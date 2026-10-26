"use client";

import type { Route } from "next";
import Link from "next/link";
import { useActionState } from "react";
import { OsirusMark } from "@/components/shell/osirus-mark";
import { requestReset } from "./actions";

export function ForgotPasswordForm() {
  const [state, action, pending] = useActionState(requestReset, null);
  return (
    <main className="auth-page">
      <form action={action} className="auth-card">
        <p className="auth-brand">
          <OsirusMark size={24} />
          Osirus
        </p>
        <h1>Passwort vergessen</h1>
        <p className="auth-lede">
          Wir schicken dir einen Link, mit dem du ein neues Passwort setzt.
        </p>
        <label>
          E-Mail
          <input name="email" type="email" autoComplete="email" required />
        </label>
        {state?.error ? (
          <p className="form-error" role="alert">
            {state.error}
          </p>
        ) : null}
        {state?.notice ? (
          <p className="form-notice" role="status">
            {state.notice}
          </p>
        ) : null}
        <button
          type="submit"
          className="btn btn-primary auth-submit"
          disabled={pending}
        >
          {pending ? "Wird gesendet…" : "Link senden"}
        </button>
        <p className="auth-footer">
          Wieder eingefallen?{" "}
          <Link href={"/auth/sign-in" as Route}>Anmelden</Link>
        </p>
      </form>
    </main>
  );
}
