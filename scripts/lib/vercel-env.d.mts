export type VercelEnvironmentRow = {
  key: string;
  target?: string | string[];
  gitBranch?: string | null;
  updatedAt?: number;
};

export function environmentTargets(environment: VercelEnvironmentRow): string[];

export function environmentApplies(
  environment: VercelEnvironmentRow,
  key: string,
  target: string,
  gitBranch?: string,
): boolean;

export function uncoveredTargets(
  environments: VercelEnvironmentRow[],
  key: string,
  targets: string[],
  gitBranch?: string,
): string[];

export function coversTargets(
  environments: VercelEnvironmentRow[],
  key: string,
  targets: string[],
  gitBranch?: string,
): boolean;

export function hasAnyValue(
  environments: VercelEnvironmentRow[],
  key: string,
): boolean;

export const UNOROUTER_KEY_NAMES: string[];
export const MODEL_ROLE_KEYS: string[];
export const FREE_POOL_SENTINEL: "free";

export function parseModelPolicy(
  value: string | undefined,
): "free-first" | "configured-first";

export function resolveRoleModel(input: {
  requested: string | undefined;
  policy: "free-first" | "configured-first";
  listedIds: Set<string>;
}): string;

export function rankFreeModels(
  listedIds: Iterable<string>,
  catalogBody: unknown,
  known?: readonly string[],
): string[];

export const NON_CHAT_ID: RegExp;
export const CHAT_FAMILY: RegExp;

export type ChatProbe = {
  id: string;
  status: number | "network_error";
  ok: boolean;
  category: "answered" | "empty" | "rate_limited" | "unavailable" | "rejected";
  latencyMs: number;
};

export function probeChatModel(input: {
  endpoint: string;
  apiKey: string;
  id: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<ChatProbe>;

export function verifiedFreeTiers(input: {
  ranked: string[];
  probe: (id: string) => Promise<ChatProbe>;
  want?: number;
  maxProbes?: number;
}): Promise<{ tiers: string[]; probes: ChatProbe[] }>;

export function staleTargets(
  environments: VercelEnvironmentRow[],
  key: string,
  targets: string[],
  sinceMs: number,
  gitBranch?: string,
): string[];

export function branchPinnedRows(
  environments: VercelEnvironmentRow[],
  key: string,
): string[];

export function parseTargetList(value: string | undefined): string[];

export function optionalSecret(value: string | undefined): string | undefined;
