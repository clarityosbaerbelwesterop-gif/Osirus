export const NEON_API: string;
export const REQUIRED_TABLES: string[];

export function vercelRegionForNeon(regionId: unknown): string | null;
export function neonRegionFromUrl(value: unknown): string | null;

type NeonRow = Record<string, unknown> & { id?: string; name?: string };

export function pickDefaultBranch(
  branches: NeonRow[] | null | undefined,
): NeonRow | null;
export function pickDatabase(
  databases: NeonRow[] | null | undefined,
): NeonRow | null;
export function missingTables(present: string[], required?: string[]): string[];

export function resolveNeonProject(input: {
  apiKey: string;
  projectId: string;
  fetchImpl?: typeof fetch;
}): Promise<{
  projectName: string;
  regionId: string | null;
  branchName: string;
  databaseName: string;
  uri: string;
}>;
