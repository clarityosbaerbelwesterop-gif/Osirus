"use client";

import Link from "next/link";
import { useState } from "react";
import { useActionState } from "react";
import { GitHubSignInButton } from "@/components/auth/github-sign-in-button";
import { OsirusMark } from "@/components/shell/osirus-mark";
import { assertSignupLegal, signUpWithEmail } from "./actions";

export function SignUpForm() {
  const [state, action, pending] = useActionState(signUpWithEmail, null);
  const [terms, setTerms] = useState(false);
  const [privacy, setPrivacy] = useState(false);
  const accepted = terms && privacy;

  return (
    <main className="auth-page">
      <form action={action} className="auth-card">
        <p className="auth-brand">
          <OsirusMark size={24} />
          Osirus
        </p>
        <h1>Konto erstellen</h1>
        <p className="auth-lede">
          Dein persönlicher Workspace ist nach der ersten Anmeldung bereit.
        </p>
        <label>
          Name
          <input name="name" type="text" autoComplete="name" required />
        </label>
        <label>
          E-Mail
          <input name="email" type="email" autoComplete="email" required />
        </label>
        <label>
          Passwort (mind. 8 Zeichen)
          <input
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={8}
            required
          />
        </label>
        <div className="auth-check">
          <input
            id="accept-terms"
            name="acceptTerms"
            type="checkbox"
            checked={terms}
            onChange={(event) => setTerms(event.target.checked)}
          />
          <label htmlFor="accept-terms">
            Ich akzeptiere die <Link href="/legal/terms">AGB</Link> und die{" "}
            <Link href="/legal/eula">EULA</Link>
          </label>
        </div>
        <div className="auth-check">
          <input
            id="accept-privacy"
            name="acceptPrivacy"
            type="checkbox"
            checked={privacy}
            onChange={(event) => setPrivacy(event.target.checked)}
          />
          <label htmlFor="accept-privacy">
            Ich habe die <Link href="/legal/privacy">Datenschutzerklärung</Link>{" "}
            gelesen
          </label>
        </div>
        {state?.error ? (
          <p className="form-error" role="alert">
            {state.error}
          </p>
        ) : null}
        <button
          type="submit"
          className="btn btn-primary auth-submit"
          disabled={pending || !accepted}
        >
          {pending ? "Wird erstellt…" : "Konto erstellen"}
        </button>
        <GitHubSignInButton
          disabled={!accepted}
          beforeStart={async () => {
            const gate = await assertSignupLegal({ terms, privacy });
            return gate?.error ?? null;
          }}
        />
        <p className="auth-footer">
          Schon registriert? <Link href="/auth/sign-in">Anmelden</Link>
        </p>
      </form>
    </main>
  );
}
