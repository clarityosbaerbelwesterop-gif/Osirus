import "server-only";
import {
  githubListMessage,
  listGrantedBranches,
  listGrantedRepositories,
  parseGithubRepository,
} from "../connectors/github";

type Identity = { userId: string; organizationId: string; workspaceId: string };

/**
 * A coding run may start only when the connected grant lists the chosen
 * repository and branch. Failure does not create a run.
 */
export async function verifyCodingSelection(
  identity: Identity,
  selection: { repository: string; branch: string },
): Promise<{ ok: true } | { ok: false; message: string }> {
  const parsed = parseGithubRepository(selection.repository);
  if (!parsed)
    return {
      ok: false,
      message: "Choose a repository from the connected grant.",
    };
  const listed = await listGrantedRepositories(identity);
  if (!listed.ok)
    return {
      ok: false,
      message: githubListMessage(listed.error, listed.status),
    };
  const match = listed.repositories.find(
    (repository) =>
      repository.owner.toLowerCase() === parsed.owner.toLowerCase() &&
      repository.name.toLowerCase() === parsed.name.toLowerCase(),
  );
  if (!match)
    return {
      ok: false,
      message: "That repository is not in the connected grant.",
    };
  const branches = await listGrantedBranches(identity, {
    owner: match.owner,
    name: match.name,
  });
  if (!branches.ok)
    return {
      ok: false,
      message: githubListMessage(branches.error, branches.status),
    };
  if (!branches.branches.includes(selection.branch))
    return {
      ok: false,
      message: "That branch is not on the repository.",
    };
  return { ok: true };
}
