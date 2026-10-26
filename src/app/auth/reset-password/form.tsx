"use client";

import type { Route } from "next";
import Link from "next/link";
import { useActionState } from "react";
import { OsirusMark } from "@/components/shell/osirus-mark";
import { resetPassword } from "./actions";

export function ResetPasswordForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState(resetPassword, null);
  return (
    <main className="auth-page">
      <form action={action} className="auth-card">
        <p className="auth-brand">
          <OsirusMark size={24} />
          Osirus
        </p>
        <h1>Neues Passwort</h1>
        <input type="hidden" name="token" value={token} />
        {token ? null : (
          <p className="form-error" role="alert">
            Dieser Link enthält keinen Code.{" "}
            <Link href={"/auth/forgot-password" as Route}>
              Neuen Link anfordern
            </Link>
          </p>
        )}
        <label>
          Neues Passwort
          <input
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={8}
            required
          />
        </label>
        <label>
          Passwort wiederholen
          <input
            name="repeat"
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
          disabled={pending || !token}
        >
          {pending ? "Speichert…" : "Passwort speichern"}
        </button>
      </form>
    </main>
  );
}
