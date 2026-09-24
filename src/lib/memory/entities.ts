import type { MemoryCandidate } from "./compiler-v2";
import type { MemoryRepository } from "./repository";

type EntityIndexInput = {
  organizationId: string;
  workspaceId: string;
  memoryItemId: string;
  candidate: MemoryCandidate;
};

function repositoryFromSubject(subjectKey: string | null | undefined) {
  if (!subjectKey?.startsWith("repo:")) return null;
  const [, repository] = subjectKey.split(":");
  return repository ?? null;
}

/** Activate the dormant entity graph for project-map and repo-scoped patterns. */
export async function indexMemoryEntities(
  repository: MemoryRepository,
  input: EntityIndexInput,
): Promise<number> {
  const repositoryUrl = repositoryFromSubject(input.candidate.subjectKey);
  if (!repositoryUrl) return 0;
  let indexed = 0;
  const repoEntityId = await repository.upsertEntity({
    organizationId: input.organizationId,
    workspaceId: input.workspaceId,
    canonicalName: repositoryUrl,
    entityType: "repository",
    confidence: input.candidate.confidence ?? 0.7,
  });
  if (!repoEntityId) return 0;
  indexed += 1;

  if (input.candidate.kind === "project_map") {
    const frameworks =
      typeof input.candidate.source === "object" &&
      input.candidate.source.memory === "repository.frameworks"
        ? String(input.candidate.canonicalValue ?? "")
            .split(",")
            .map((entry) => entry.trim())
            .filter(Boolean)
        : [];
    for (const framework of frameworks.slice(0, 8)) {
      const frameworkId = await repository.upsertEntity({
        organizationId: input.organizationId,
        workspaceId: input.workspaceId,
        canonicalName: framework,
        entityType: "framework",
        confidence: input.candidate.confidence ?? 0.7,
      });
      if (!frameworkId) continue;
      indexed += 1;
      await repository.linkEntities({
        organizationId: input.organizationId,
        workspaceId: input.workspaceId,
        fromEntityId: repoEntityId,
        toEntityId: frameworkId,
        relationType: "uses",
        sourceMemoryId: input.memoryItemId,
        confidence: input.candidate.confidence ?? 0.7,
        provenance: input.candidate.source,
      });
    }
  }

  if (
    input.candidate.kind === "pattern" &&
    typeof input.candidate.source === "object" &&
    input.candidate.source.memory === "experience.command"
  ) {
    const command = input.candidate.canonicalValue ?? input.candidate.content;
    const workflowId = await repository.upsertEntity({
      organizationId: input.organizationId,
      workspaceId: input.workspaceId,
      canonicalName: command,
      entityType: "workflow",
      confidence: input.candidate.confidence ?? 0.7,
    });
    if (workflowId) {
      indexed += 1;
      await repository.linkEntities({
        organizationId: input.organizationId,
        workspaceId: input.workspaceId,
        fromEntityId: repoEntityId,
        toEntityId: workflowId,
        relationType: "checked_by",
        sourceMemoryId: input.memoryItemId,
        confidence: input.candidate.confidence ?? 0.7,
        provenance: input.candidate.source,
      });
    }
  }

  return indexed;
}
