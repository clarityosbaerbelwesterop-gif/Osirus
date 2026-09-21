export type VercelEnvironmentRow = {
  key: string;
  target?: string | string[];
  gitBranch?: string | null;
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

export function isAllowedPrimaryModel(model: string): boolean;

export function parseTargetList(value: string | undefined): string[];

export function optionalSecret(value: string | undefined): string | undefined;
