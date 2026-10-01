// Per-viewer interface preferences, kept in cookies so the server renders the
// right theme and sidebar state on the first paint (no flash, no script).

export const THEME_COOKIE = "osirus-theme";
export const SIDEBAR_COOKIE = "osirus-sidebar";
export const MODE_COOKIE = "osirus-mode";

export type ThemePreference = "system" | "light" | "dark";
export type ModePreference =
  "auto" | "research" | "coding" | "reasoning" | "agent";

export function parseTheme(value: string | undefined | null): ThemePreference {
  return value === "light" || value === "dark" ? value : "system";
}

export function parseSidebar(value: string | undefined | null) {
  return value === "collapsed" ? "collapsed" : "expanded";
}

export function parseMode(value: string | undefined | null): ModePreference {
  return value === "research" ||
    value === "coding" ||
    value === "reasoning" ||
    value === "agent"
    ? value
    : "auto";
}

const YEAR = 60 * 60 * 24 * 365;

/** Browser-only: persist a preference cookie for a year. */
export function writePreference(name: string, value: string) {
  // Secure is added only over https: on a plain-http localhost origin the
  // attribute would make the browser silently reject the cookie.
  const secure =
    typeof location !== "undefined" && location.protocol === "https:"
      ? "; Secure"
      : "";
  document.cookie = `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${YEAR}; SameSite=Lax${secure}`;
}

/** Browser-only: read a preference cookie written by writePreference. */
export function readPreference(name: string): string | null {
  if (typeof document === "undefined") return null;
  const entry = document.cookie
    .split("; ")
    .find((part) => part.startsWith(`${name}=`));
  return entry ? decodeURIComponent(entry.slice(name.length + 1)) : null;
}

export function applyTheme(theme: ThemePreference) {
  const root = document.documentElement;
  if (theme === "system") delete root.dataset.theme;
  else root.dataset.theme = theme;
  writePreference(THEME_COOKIE, theme);
}
