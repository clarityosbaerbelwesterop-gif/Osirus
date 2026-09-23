// Narrow readers for the loosely typed rows a run snapshot carries.

export type Row = Record<string, unknown>;

export function str(value: unknown, key: string): string | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = (value as Row)[key];
  return typeof raw === "string" ? raw : null;
}

export function num(value: unknown, key: string): number | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = (value as Row)[key];
  const parsed = typeof raw === "string" ? Number(raw) : raw;
  return typeof parsed === "number" && Number.isFinite(parsed) ? parsed : null;
}

export function obj(value: unknown, key: string): Row | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = (value as Row)[key];
  return typeof raw === "object" && raw !== null && !Array.isArray(raw)
    ? (raw as Row)
    : null;
}

export function list(value: unknown, key: string): unknown[] {
  if (typeof value !== "object" || value === null) return [];
  const raw = (value as Row)[key];
  return Array.isArray(raw) ? raw : [];
}

export function iso(value: unknown, key: string): string | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = (value as Row)[key];
  if (typeof raw === "string") return raw;
  if (raw instanceof Date) return raw.toISOString();
  return null;
}
