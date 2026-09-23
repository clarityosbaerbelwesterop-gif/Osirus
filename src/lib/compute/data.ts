// Tabular data analysis, in process.
//
// Deterministic and bounded: it parses the data it is given, infers column
// types, and computes what it reports. Nothing here is estimated by a model.

export type Row = Record<string, string | number | boolean | null>;

export type ColumnSummary = {
  name: string;
  type: "number" | "string" | "boolean" | "empty";
  count: number;
  missing: number;
  distinct: number;
  mean?: number;
  median?: number;
  std?: number;
  min?: number;
  max?: number;
  topValues?: Array<{ value: string; count: number }>;
};

export type DataAnalysis = {
  rows: number;
  columns: ColumnSummary[];
  duplicates: number;
  correlations: Array<{ a: string; b: string; pearson: number }>;
  anomalies: Array<{
    column: string;
    row: number;
    value: number;
    zScore: number;
  }>;
  groups?: Array<{ key: string; count: number; aggregate: number | null }>;
};

const MAX_ROWS = 50_000;

/** RFC 4180 CSV: quoted fields, escaped quotes, embedded commas and newlines. */
export function parseCsv(text: string): Row[] {
  const records: string[][] = [];
  let field = "";
  let record: string[] = [];
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]!;
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else quoted = false;
      } else field += char;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === ",") {
      record.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i += 1;
      record.push(field);
      field = "";
      if (record.some((value) => value !== "")) records.push(record);
      record = [];
      if (records.length > MAX_ROWS + 1) break;
    } else field += char;
  }
  if (field !== "" || record.length) {
    record.push(field);
    if (record.some((value) => value !== "")) records.push(record);
  }
  const [header, ...body] = records;
  if (!header) return [];
  const names = header.map(
    (name, index) => name.trim() || `column_${index + 1}`,
  );
  return body.map((values) =>
    Object.fromEntries(
      names.map((name, index) => [name, coerce(values[index])]),
    ),
  );
}

function coerce(raw: string | undefined): string | number | boolean | null {
  if (raw === undefined) return null;
  const value = raw.trim();
  if (value === "" || /^(null|na|n\/a|nan)$/i.test(value)) return null;
  if (/^(true|false)$/i.test(value)) return value.toLowerCase() === "true";
  const numeric = Number(value.replaceAll(",", ""));
  if (
    /^[-+]?[\d,]*\.?\d+(e[-+]?\d+)?$/i.test(value) &&
    Number.isFinite(numeric)
  )
    return numeric;
  return value;
}

function median(sorted: number[]) {
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[mid]!
    : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function pearson(x: number[], y: number[]) {
  const n = x.length;
  const mx = x.reduce((a, b) => a + b, 0) / n;
  const my = y.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i += 1) {
    num += (x[i]! - mx) * (y[i]! - my);
    dx += (x[i]! - mx) ** 2;
    dy += (y[i]! - my) ** 2;
  }
  return dx && dy ? num / Math.sqrt(dx * dy) : 0;
}

export function analyzeRows(
  input: Row[],
  options: {
    groupBy?: string;
    aggregate?: {
      column: string;
      fn: "sum" | "mean" | "count" | "min" | "max";
    };
  } = {},
): DataAnalysis {
  const rows = input.slice(0, MAX_ROWS);
  const names = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const columns: ColumnSummary[] = names.map((name) => {
    const values = rows.map((row) => row[name] ?? null);
    const present = values.filter((value) => value !== null);
    const numbers = present.filter(
      (value): value is number => typeof value === "number",
    );
    const type: ColumnSummary["type"] =
      present.length === 0
        ? "empty"
        : numbers.length === present.length
          ? "number"
          : present.every((value) => typeof value === "boolean")
            ? "boolean"
            : "string";
    const summary: ColumnSummary = {
      name,
      type,
      count: present.length,
      missing: values.length - present.length,
      distinct: new Set(present.map(String)).size,
    };
    if (type === "number" && numbers.length) {
      const sorted = [...numbers].sort((a, b) => a - b);
      const mean = numbers.reduce((a, b) => a + b, 0) / numbers.length;
      summary.mean = mean;
      summary.median = median(sorted);
      summary.std =
        numbers.length > 1
          ? Math.sqrt(
              numbers.reduce((acc, value) => acc + (value - mean) ** 2, 0) /
                (numbers.length - 1),
            )
          : 0;
      summary.min = sorted[0];
      summary.max = sorted[sorted.length - 1];
    } else if (type === "string") {
      const counts = new Map<string, number>();
      for (const value of present)
        counts.set(String(value), (counts.get(String(value)) ?? 0) + 1);
      summary.topValues = [...counts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([value, count]) => ({ value: value.slice(0, 80), count }));
    }
    return summary;
  });

  const numeric = columns.filter((column) => column.type === "number");
  const correlations: DataAnalysis["correlations"] = [];
  for (let i = 0; i < numeric.length; i += 1) {
    for (let j = i + 1; j < numeric.length; j += 1) {
      const a = numeric[i]!.name;
      const b = numeric[j]!.name;
      const pairs = rows
        .map((row) => [row[a], row[b]])
        .filter(
          (pair): pair is [number, number] =>
            typeof pair[0] === "number" && typeof pair[1] === "number",
        );
      if (pairs.length >= 3) {
        correlations.push({
          a,
          b,
          pearson: Number(
            pearson(
              pairs.map((p) => p[0]),
              pairs.map((p) => p[1]),
            ).toFixed(6),
          ),
        });
      }
    }
  }

  const anomalies: DataAnalysis["anomalies"] = [];
  for (const column of numeric) {
    if (!column.std) continue;
    rows.forEach((row, index) => {
      const value = row[column.name];
      if (typeof value !== "number") return;
      const z = (value - column.mean!) / column.std!;
      if (Math.abs(z) > 3)
        anomalies.push({
          column: column.name,
          row: index,
          value,
          zScore: Number(z.toFixed(3)),
        });
    });
  }

  const seen = new Set<string>();
  let duplicates = 0;
  for (const row of rows) {
    const key = JSON.stringify(row);
    if (seen.has(key)) duplicates += 1;
    seen.add(key);
  }

  let groups: DataAnalysis["groups"];
  if (options.groupBy) {
    const buckets = new Map<string, Row[]>();
    for (const row of rows) {
      const key = String(row[options.groupBy] ?? "(missing)");
      buckets.set(key, [...(buckets.get(key) ?? []), row]);
    }
    groups = [...buckets.entries()].map(([key, members]) => {
      const agg = options.aggregate;
      let aggregate: number | null = null;
      if (agg) {
        const values = members
          .map((row) => row[agg.column])
          .filter((v): v is number => typeof v === "number");
        if (agg.fn === "count") aggregate = members.length;
        else if (values.length) {
          aggregate =
            agg.fn === "sum"
              ? values.reduce((a, b) => a + b, 0)
              : agg.fn === "mean"
                ? values.reduce((a, b) => a + b, 0) / values.length
                : agg.fn === "min"
                  ? Math.min(...values)
                  : Math.max(...values);
        }
      }
      return { key, count: members.length, aggregate };
    });
  }

  return {
    rows: rows.length,
    columns,
    duplicates,
    correlations,
    anomalies: anomalies.slice(0, 50),
    groups,
  };
}
