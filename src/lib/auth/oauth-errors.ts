// What a person sees when "Continue with GitHub" comes back with an error.
// Neon Auth (Better Auth) returns to `errorCallbackURL?error=<code>`; before
// this, a failed OAuth round trip landed on the sign-in page with no message
// at all, which looked exactly like a login loop.

const MESSAGES: Record<string, string> = {
  access_denied: "GitHub sign-in was cancelled.",
  state_mismatch:
    "The sign-in expired or was finished in another browser tab. Please start again here.",
  state_not_found:
    "The sign-in expired or was finished in another browser tab. Please start again here.",
  please_restart_the_process:
    "The sign-in expired or was finished in another browser tab. Please start again here.",
  invalid_callback_request:
    "GitHub did not complete the sign-in. Please try again.",
  no_code: "GitHub did not complete the sign-in. Please try again.",
  unable_to_get_user_info:
    "GitHub did not share your profile. Please try again.",
  email_not_found:
    "Your GitHub account has no email address Osirus can use. Add a verified email on GitHub, or sign in with email and password.",
  account_not_linked:
    "An Osirus account with this email already exists. Sign in with email and password.",
  unable_to_link_account:
    "An Osirus account with this email already exists. Sign in with email and password.",
  signup_disabled: "New accounts cannot be created right now.",
};

const FALLBACK = "GitHub sign-in did not complete. Please try again.";

/** A readable message for an OAuth error code, or null when there is none. */
export function oauthErrorMessage(
  code: string | string[] | null | undefined,
): string | null {
  const value = Array.isArray(code) ? code[0] : code;
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (!/^[a-z0-9_.-]{1,64}$/.test(normalized)) return FALLBACK;
  return MESSAGES[normalized] ?? `${FALLBACK} (${normalized})`;
}
