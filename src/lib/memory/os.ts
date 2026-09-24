import {
  memoryCandidates,
  type RunOutcome,
} from "./compiler-v2";
import { indexMemoryEntities } from "./entities";
import {
  bundleFromItems,
  type MemoryBundle,
} from "./planes";
import type { MemoryItem } from ".";
import {
  MemoryRepository,
  type MemoryPersistResult,
  type MemoryRetrieveInput,
} from "./repository";

export type MemoryContradiction = {
  id: string;
  kind: string;
  content: string;
  subjectKey: string | null;
  canonicalValue: string | null;
  updatedAt: string;
  rivalIds: string[];
};

export type MemoryCommitResult = {
  candidates: number;
  promoted: number;
  verified: boolean;
  entitiesIndexed: number;
  results: MemoryPersistResult[];
};

/**
 * Memory OS I: a coordinator over the existing three-brain store.
 *
 * It does not replace MemoryRepository, Compiler v2, or the runtime scheduler.
 * It routes retrieval into episodic / semantic / procedural / strategic planes,
 * indexes entities on verified promotion, and surfaces contradiction queues.
 */
export class MemoryOS {
  readonly repository: MemoryRepository;

  constructor(private readonly actorId: string) {
    this.repository = new MemoryRepository(actorId);
  }

  /** Backward-compatible flat retrieval used by arms, tools, and the loop. */
  async retrieve(
    input: MemoryRetrieveInput,
  ): Promise<MemoryItem[]> {
    const bundle = await this.retrieveBundle(input);
    return [
      ...bundle.planes.episodic,
      ...bundle.planes.semantic,
      ...bundle.planes.procedural,
      ...bundle.planes.strategic,
    ];
  }

  async retrieveBundle(
    input: MemoryRetrieveInput,
  ): Promise<MemoryBundle> {
    const [lexical, episodic, contradictions] = await Promise.all([
      this.repository.retrieve(input),
      this.repository.episodicByObjective(
        input.workspaceId,
        input.objective,
        Math.min(input.limit ?? 8, 6),
      ),
      this.repository.countContradictions(input.workspaceId),
    ]);
    const merged = [...episodic, ...lexical];
    return bundleFromItems(merged, contradictions);
  }

  async commit(input: {
    organizationId: string;
    workspaceId: string;
    sessionId?: string | null;
    runId: string;
    armId: string;
    objective: string;
    answer: string;
    verdicts: string[];
    state: Record<string, unknown>;
  }): Promise<MemoryCommitResult> {
    const outcome: RunOutcome = {
      runId: input.runId,
      armId: input.armId,
      objective: input.objective,
      answer: input.answer,
      verdicts: input.verdicts,
      state: input.state,
    };
    const candidates = memoryCandidates(outcome);
    const verified =
      input.verdicts.length > 0 &&
      input.verdicts.every((verdict) => verdict === "verified");
    const toStore = input.answer ? candidates : candidates.slice(1);
    const results: MemoryPersistResult[] = [];
    let promoted = 0;
    let entitiesIndexed = 0;
    for (const candidate of toStore) {
      const result = await this.repository
        .compileAndStore({
          ...candidate,
          organizationId: input.organizationId,
          workspaceId: input.workspaceId,
          sessionId: input.sessionId ?? null,
          runId: input.runId,
          tier: "second",
        })
        .catch(() => null);
      if (!result) continue;
      results.push(result);
      if (!result.persistedId) continue;
      promoted += 1;
      entitiesIndexed += await indexMemoryEntities(this.repository, {
        organizationId: input.organizationId,
        workspaceId: input.workspaceId,
        memoryItemId: result.persistedId,
        candidate,
      }).catch(() => 0);
    }
    return {
      candidates: candidates.length,
      promoted,
      verified,
      entitiesIndexed,
      results,
    };
  }

  async listContradictions(workspaceId: string, limit = 20) {
    return this.repository.listContradictions(workspaceId, limit);
  }

  async resolveContradiction(input: {
    workspaceId: string;
    winningMemoryId: string;
    rejectedMemoryIds: string[];
  }) {
    await this.repository.resolveConflict(input);
  }
}
