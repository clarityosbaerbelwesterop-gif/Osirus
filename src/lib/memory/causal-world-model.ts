import {
  extractCausalGraph,
  renderCausalNarrative,
  type CausalEvent,
  type CausalLink,
} from "./causal";
import { rankByTemporal, temporalScore } from "./temporal";
import type { RunOutcome } from "./compiler-v2";

// Memory OS II: causal / temporal / relational world model.
//
// Sits on top of Memory OS I (retrieval, compiler, entities) and the existing
// WorldModel. No second runtime: graphs are derived from persisted records and
// replayed into the first brain at retrieval time.

export type RelationalNode = {
  id: string;
  label: string;
  kind: string;
  confidence: number;
  updatedAt: string;
};

export type RelationalEdge = {
  from: string;
  to: string;
  relation: string;
  confidence: number;
};

export type CausalWorldModel = {
  events: CausalEvent[];
  links: CausalLink[];
  relationalNodes: RelationalNode[];
  relationalEdges: RelationalEdge[];
  /** Causal chains ranked by temporal relevance for agent decisions. */
  narrative: string[];
  /** Events sorted by decay-adjusted confidence. */
  rankedEvents: Array<CausalEvent & { temporalScore: number }>;
};

export type StoredCausalRow = {
  id: string;
  canonical_name: string;
  entity_type: string;
  confidence: string | number;
  attributes: Record<string, unknown>;
  updated_at: string | Date;
};

export type StoredRelationRow = {
  from_entity_id: string;
  to_entity_id: string;
  from_name: string;
  to_name: string;
  from_type: string;
  to_type: string;
  relation_type: string;
  confidence: string | number;
  created_at: string | Date;
};

/** Build an in-memory causal world model from a run outcome (no database). */
export function buildCausalWorldModelFromOutcome(
  outcome: RunOutcome,
  now?: Date,
): CausalWorldModel {
  const { events, links } = extractCausalGraph(outcome);
  return assembleCausalWorldModel({ events, links, nodes: [], edges: [] }, now);
}

/** Merge persisted relational data with extracted or stored causal events. */
export function assembleCausalWorldModel(
  input: {
    events: CausalEvent[];
    links: CausalLink[];
    nodes: RelationalNode[];
    edges: RelationalEdge[];
  },
  now?: Date,
): CausalWorldModel {
  const rankedEvents = rankByTemporal(
    input.events.map((item) => ({
      ...item,
      updatedAt: item.occurredAt,
      importance: item.confidence,
    })),
    (item) => item.confidence,
    now,
  ).map((item) => ({
    ...item,
    temporalScore: item.score ?? item.confidence,
  }));

  const narrative = renderCausalNarrative(
    rankedEvents.slice(0, 12),
    input.links,
    8,
  );

  return {
    events: input.events,
    links: input.links,
    relationalNodes: input.nodes,
    relationalEdges: input.edges,
    narrative,
    rankedEvents,
  };
}

export function mapStoredEntities(rows: StoredCausalRow[]): RelationalNode[] {
  return rows.map((row) => ({
    id: row.id,
    label: row.canonical_name,
    kind: row.entity_type,
    confidence: Number(row.confidence),
    updatedAt: new Date(row.updated_at).toISOString(),
  }));
}

export function mapStoredRelations(
  rows: StoredRelationRow[],
  entityIdToLabel: Map<string, string>,
): RelationalEdge[] {
  return rows.map((row) => ({
    from: entityIdToLabel.get(row.from_entity_id) ?? row.from_name,
    to: entityIdToLabel.get(row.to_entity_id) ?? row.to_name,
    relation: row.relation_type,
    confidence: Number(row.confidence),
  }));
}

/** Score how relevant a relational edge is for a query, with temporal decay. */
export function scoreRelationalEdge(
  edge: RelationalEdge,
  query: string,
  updatedAt: string | Date,
  now?: Date,
): number {
  const terms = query
    .toLowerCase()
    .split(/\W+/)
    .filter((term) => term.length > 2);
  let overlap = 0;
  const haystack = `${edge.from} ${edge.to} ${edge.relation}`.toLowerCase();
  for (const term of terms) {
    if (haystack.includes(term)) overlap += 1;
  }
  const base = overlap > 0 ? overlap / terms.length : 0.1;
  return temporalScore(base * edge.confidence, updatedAt, edge.confidence, now);
}

/** Format causal world model slices for the first brain memory bucket. */
export function formatCausalContext(
  model: CausalWorldModel,
  limit = 6,
): string[] {
  const lines: string[] = [];
  for (const line of model.narrative.slice(0, limit)) {
    lines.push(`[causal] ${line}`);
  }
  for (const edge of model.relationalEdges.slice(0, limit - lines.length)) {
    lines.push(
      `[relational] ${edge.from} —${edge.relation}→ ${edge.to} (${edge.confidence.toFixed(2)})`,
    );
  }
  for (const event of model.rankedEvents.slice(0, limit - lines.length)) {
    lines.push(
      `[${event.kind}] ${event.label} (score ${event.temporalScore.toFixed(2)})`,
    );
  }
  return lines.slice(0, limit);
}

export { extractCausalGraph, renderCausalNarrative };
export type { CausalEvent, CausalLink } from "./causal";
