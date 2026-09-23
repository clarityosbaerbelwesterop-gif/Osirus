// Repository references in free text. Pure, so the composer can show the
// same repository the coding arm will open, without a server round trip.

const GITHUB_REPO =
  /https:\/\/github\.com\/[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}?(?:\.git)?(?=[\s)>\]"'`,;]|$|\/(?:\s|$))/;

/** The first github.com repository URL an objective names, if any. */
export function repositoryInObjective(objective: string) {
  const match = objective.match(GITHUB_REPO);
  return match ? match[0].replace(/\.git$/, "") : null;
}

/** "owner/name" for display, from a repository URL. */
export function repositoryShortName(url: string) {
  return url.replace(/^https:\/\/github\.com\//, "").replace(/\/$/, "");
}
