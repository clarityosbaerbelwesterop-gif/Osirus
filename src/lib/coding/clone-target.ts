/**
 * The only repository git is allowed to clone: https://github.com/owner/name.
 * Query strings, credentials, other hosts, and extra path segments are refused.
 * Branch names cannot be git options.
 */

const OWNER = /^[A-Za-z0-9-]{1,39}$/;
const NAME = /^[A-Za-z0-9._-]{1,100}$/;
const BRANCH =
  /^(?!.*\.\.)(?!.*\/\/)(?!\/)(?!.*\/$)(?!-)[A-Za-z0-9._/-]{1,100}$/;

export function canonicalGithubCloneUrl(input: string): string {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error("only_https_github_clones_are_supported");
  }
  if (url.protocol !== "https:" || url.hostname !== "github.com") {
    throw new Error("only_https_github_clones_are_supported");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("only_https_github_clones_are_supported");
  }
  const parts = url.pathname.split("/").filter((part) => part.length > 0);
  if (parts.length !== 2) {
    throw new Error("only_https_github_clones_are_supported");
  }
  const owner = parts[0] ?? "";
  const name = (parts[1] ?? "").replace(/\.git$/, "");
  if (!OWNER.test(owner) || !NAME.test(name) || name.length === 0) {
    throw new Error("only_https_github_clones_are_supported");
  }
  return `https://github.com/${owner}/${name}.git`;
}

export function cloneBranch(branch: string | undefined): string | undefined {
  if (branch === undefined) return undefined;
  if (!BRANCH.test(branch)) throw new Error("branch_name_invalid");
  return branch;
}

export function cloneDepth(depth: number | undefined): string {
  const value = depth ?? 50;
  if (!Number.isInteger(value) || value < 1 || value > 200) {
    throw new Error("clone_depth_invalid");
  }
  return String(value);
}
