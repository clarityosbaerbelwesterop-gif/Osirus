"use client";

import { authClient } from "@/lib/auth/client";
import { useState } from "react";
import { GithubMark } from "./github-mark";

/**
 * Starts Neon Auth's server-managed OAuth flow. The provider owns PKCE/state,
 * while this component keeps the return location fixed inside Osirus.
 */
export function GitHubSignInButton({
  disabled = false,
  beforeStart,
}: {
  disabled?: boolean;
  /** Return an error string to stop the redirect. Used by registration. */
  beforeStart?: () => Promise<string | null>;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signInWithGitHub() {
    if (disabled) return;
    setPending(true);
    setError(null);

    try {
      if (beforeStart) {
        const blocked = await beforeStart();
        if (blocked) {
          setError(blocked);
          setPending(false);
          return;
        }
      }
      const result = await authClient.signIn.social({
        provider: "github",
        callbackURL: "/app",
        // A failed round trip comes back here with ?error=<code>, which the
        // sign-in page explains, instead of stranding the person elsewhere.
        errorCallbackURL: "/auth/sign-in",
      });
      if (result.error) {
        setError("GitHub sign-in could not be started. Please try again.");
        setPending(false);
      }
    } catch {
      setError("GitHub sign-in could not be started. Please try again.");
      setPending(false);
    }
  }

  return (
    <div className="social-auth">
      <div className="auth-divider" aria-hidden="true">
        <span />
        or
        <span />
      </div>
      <button
        className="social-auth-button"
        type="button"
        disabled={disabled || pending}
        onClick={signInWithGitHub}
      >
        <GithubMark />
        {pending ? "Redirecting to GitHub…" : "Continue with GitHub"}
      </button>
      {error ? (
        <p aria-live="polite" className="form-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}
