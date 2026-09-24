import "server-only";
import { queryAs } from "../db/client";

// The WorldModel: what this workspace's runs have established about the
// world, as entities and relations -- derived on demand from records the
// runtime already keeps (repository maps of coding workspaces, research
// claims with their supporting and contradicting sources). It has no table
// of its own, so it is always rebuildable and can never drift from its
// sources or grow into a second memory. Contested and thin claims are
// reported as uncertainties, not facts.

type Identity = { userId: string; workspaceId: string };

export type WorldEntity = {
  id: string;
  kind:
    "repository" | "framework" | "language" | "workflow" | "claim" | "source";
  label: string;
  attributes: Record<string, unknown>;
};

export type WorldEdge = {
  from: string;
  to: string;
  relation: "uses" | "written_in" | "checked_by" | "supports" | "contradicts";
};

export type WorldModel = {
  entities: WorldEntity[];
  edges: WorldEdge[];
  uncertainties: Array<{ claim: string; status: string; confidence: number }>;
};

type RepositoryRow = {
  repository: string;
  repository_map: {
    languages?: Array<{ language: string; files: number }>;
    frameworks?: string[];
    ciWorkflows?: string[];
    testDirs?: string[];
    packageManager?: string | null;
  } | null;
  updated_at: string;
};

type ClaimRow = {
  id: string;
  statement: string;
  status: string;
  confidence: string | number;
  document_id: string | null;
  relation: "supports" | "contradicts" | null;
  url: string | null;
  title: string | null;
};

export async function buildWorldModel(
  identity: Identity,
  input: { about?: string; limit?: number } = {},
): Promise<WorldModel> {
  const about = input.about?.trim().toLowerCase() ?? "";
  const limit = Math.min(input.limit ?? 40, 100);
  const [repositories, claims] = await Promise.all([
    queryAs<RepositoryRow>(
      identity.userId,
      `select distinct on (w.repository) w.repository, w.repository_map,
              w.updated_at
         from osirus.coding_workspaces w
         join osirus.runs r on r.id = w.run_id
        where r.workspace_id = $1::uuid and w.repository is not null
        order by w.repository, w.updated_at desc
        limit 20`,
      [identity.workspaceId],
    ).catch(() => [] as RepositoryRow[]),
    queryAs<ClaimRow>(
      identity.userId,
      `select c.id, c.statement, c.status, c.confidence, l.document_id,
              l.relation, d.url, d.title
         from osirus.research_claims c
         join osirus.runs r on r.id = c.run_id
         left join osirus.evidence_links l on l.claim_id = c.id
         left join osirus.research_documents d on d.id = l.document_id
        where r.workspace_id = $1::uuid
          and ($2 = '' or lower(c.statement) like '%' || $2 || '%')
        order by c.created_at desc
        limit 200`,
      [identity.workspaceId, about],
    ).catch(() => [] as ClaimRow[]),
  ]);

  const entities = new Map<string, WorldEntity>();
  const edges: WorldEdge[] = [];
  const add = (entity: WorldEntity) => {
    if (!entities.has(entity.id)) entities.set(entity.id, entity);
    return entity.id;
  };

  for (const row of repositories) {
    if (about && !row.repository.toLowerCase().includes(about)) {
      const map = JSON.stringify(row.repository_map ?? {}).toLowerCase();
      if (!map.includes(about)) continue;
    }
    const map = row.repository_map ?? {};
    const repo = add({
      id: `repo:${row.repository}`,
      kind: "repository",
      label: row.repository,
      attributes: {
        packageManager: map.packageManager ?? null,
        testDirs: (map.testDirs ?? []).slice(0, 10),
        lastSeen: new Date(row.updated_at).toISOString(),
      },
    });
    for (const framework of (map.frameworks ?? []).slice(0, 10))
      edges.push({
        from: repo,
        to: add({
          id: `framework:${framework}`,
          kind: "framework",
          label: framework,
          attributes: {},
        }),
        relation: "uses",
      });
    for (const language of (map.languages ?? []).slice(0, 5))
      edges.push({
        from: repo,
        to: add({
          id: `language:${language.language}`,
          kind: "language",
          label: language.language,
          attributes: {},
        }),
        relation: "written_in",
      });
    for (const workflow of (map.ciWorkflows ?? []).slice(0, 10))
      edges.push({
        from: repo,
        to: add({
          id: `workflow:${row.repository}:${workflow}`,
          kind: "workflow",
          label: workflow,
          attributes: {},
        }),
        relation: "checked_by",
      });
  }

  const uncertainties: WorldModel["uncertainties"] = [];
  for (const row of claims) {
    const claim = add({
      id: `claim:${row.id}`,
      kind: "claim",
      label: row.statement.slice(0, 300),
      attributes: { status: row.status, confidence: Number(row.confidence) },
    });
    if (row.document_id && row.relation)
      edges.push({
        from: add({
          id: `source:${row.document_id}`,
          kind: "source",
          label: row.title ?? row.url ?? "source",
          attributes: { url: row.url },
        }),
        to: claim,
        relation: row.relation,
      });
    if (
      row.status !== "SUPPORTED" &&
      !uncertainties.some((entry) => entry.claim === row.statement)
    )
      uncertainties.push({
        claim: row.statement.slice(0, 300),
        status: row.status,
        confidence: Number(row.confidence),
      });
  }

  const kept = [...entities.values()].slice(0, limit);
  const ids = new Set(kept.map((entity) => entity.id));
  return {
    entities: kept,
    edges: edges.filter((edge) => ids.has(edge.from) && ids.has(edge.to)),
    uncertainties: uncertainties.slice(0, 20),
  };
}
