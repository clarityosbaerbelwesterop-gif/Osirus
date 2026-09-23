// Per-viewer interface preferences, kept in cookies so the server renders the
// right theme and sidebar state on the first paint (no flash, no script).

export const THEME_COOKIE = "osirus-theme";
export const SIDEBAR_COOKIE = "osirus-sidebar";

export type ThemePreference = "system" | "light" | "dark";

export function parseTheme(value: string | undefined | null): ThemePreference {
  return value === "light" || value === "dark" ? value : "system";
}

export function parseSidebar(value: string | undefined | null) {
  return value === "collapsed" ? "collapsed" : "expanded";
}

const YEAR = 60 * 60 * 24 * 365;

/** Browser-only: persist a preference cookie for a year. */
export function writePreference(name: string, value: string) {
  document.cookie = `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${YEAR}; SameSite=Lax`;
}

export function applyTheme(theme: ThemePreference) {
  const root = document.documentElement;
  if (theme === "system") delete root.dataset.theme;
  else root.dataset.theme = theme;
  writePreference(THEME_COOKIE, theme);
}
