/**
 * AI Lab — data pipeline stage implementations (Phase J).
 *
 * Pure, dependency-free TypeScript transforms over in-memory records. Each
 * stage is separately testable and side-effect free; the registry manifest
 * (contracts/dataset.ts) records which methods ran. Methodology per
 * docs/AI_LAB_DEEPSEEK_REUSE.md §§ 3–4 and ai-lab/ARCHITECTURE.md § 1:
 *
 *   license-filter → dedup (exact + near) → decontamination → repo ordering
 *
 * No network, no filesystem, no external packages. Hashing uses FNV-1a
 * implemented inline so the module works in any JS runtime.
 */

/** A single raw data record flowing through the pipeline. */
export interface DataRecord {
  /** Stable identifier of the record (e.g. "repo/path/to/file.py"). */
  readonly id: string;
  /** Raw text content (source file, document, …). */
  readonly content: string;
  /**
   * SPDX-style license identifier of the source (e.g. "Apache-2.0",
   * "BSD-3-Clause"). Records without a license are dropped by the
   * license filter — ingestion without license evidence is prohibited.
   */
  readonly license?: string;
  /**
   * True when the author exercised a documented opt-out (e.g. The Stack
   * opt-out list). Opt-outs are always honored regardless of policy.
   */
  readonly optOut?: boolean;
}

/**
 * License filter policy. `allowedLicenses` holds lowercase SPDX ids; a
 * trailing `*` acts as a prefix glob ("bsd-*" matches "bsd-2-clause",
 * "bsd-3-clause"). `optedOutIds` is an explicit per-record opt-out list
 * honored in addition to the per-record `optOut` flag.
 */
export interface LicensePolicy {
  readonly allowedLicenses: readonly string[];
  readonly optedOutIds?: readonly string[];
}

/**
 * Default permissive allowlist for code corpora (per POLICY.md): Apache-2.0,
 * MIT, BSD family, CC-BY family, Unlicense and friends. Copyleft and
 * non-commercial licenses (GPL, AGPL, CC-BY-NC-*, …) are excluded.
 */
export const DEFAULT_LICENSE_POLICY: LicensePolicy = {
  allowedLicenses: [
    "apache-2.0",
    "mit",
    "mit-0",
    "isc",
    "bsd-*",
    "cc-by-*",
    "cc0-1.0",
    "unlicense",
    "zlib",
    "bsl-1.0",
    "0bsd",
    "python-2.0",
  ],
};

/** FNV-1a 32-bit hash of a string. Deterministic, dependency-free. */
export function fnv1aHash(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    // 32-bit FNV prime multiply via shifts to stay in integer range.
    hash =
      (hash +
        ((hash << 1) +
          (hash << 4) +
          (hash << 7) +
          (hash << 8) +
          (hash << 24))) >>>
      0;
  }
  return hash >>> 0;
}

/** Normalize a license string for comparison (lowercase, trimmed). */
function normalizeLicense(license: string): string {
  return license.trim().toLowerCase();
}

/**
 * License markers that are always denied, even when a prefix glob would
 * otherwise match: non-commercial (-nc) and no-derivatives (-nd) variants,
 * e.g. "cc-by-nc-4.0" must not pass the "cc-by-*" allowlist entry.
 */
const ALWAYS_DENIED_MARKERS = ["-nc", "-nd"] as const;

/** True when `license` matches one allowlist entry (exact or `*` prefix). */
export function isLicenseAllowed(
  license: string,
  policy: LicensePolicy,
): boolean {
  const normalized = normalizeLicense(license);
  if (ALWAYS_DENIED_MARKERS.some((marker) => normalized.includes(marker))) {
    return false;
  }
  return policy.allowedLicenses.some((entry) => {
    const pattern = normalizeLicense(entry);
    if (pattern.endsWith("*")) {
      return normalized.startsWith(pattern.slice(0, -1));
    }
    return normalized === pattern;
  });
}

/**
 * Stage 2 — license filter. Keeps records whose license matches the policy
 * allowlist and that are not opted out (record flag or policy id list).
 * Records without license evidence are dropped. Order is preserved.
 */
export function licenseFilter(
  records: readonly DataRecord[],
  policy: LicensePolicy = DEFAULT_LICENSE_POLICY,
): DataRecord[] {
  const optedOut = new Set(policy.optedOutIds ?? []);
  return records.filter((record) => {
    if (record.optOut === true || optedOut.has(record.id)) {
      return false;
    }
    if (typeof record.license !== "string" || record.license.trim() === "") {
      return false;
    }
    return isLicenseAllowed(record.license, policy);
  });
}

/**
 * Stage 3a — exact dedup by content hash (FNV-1a). The first occurrence of
 * each distinct content wins; output order follows input order.
 */
export function exactDedup(records: readonly DataRecord[]): DataRecord[] {
  const seen = new Set<number>();
  const kept: DataRecord[] = [];
  for (const record of records) {
    const hash = fnv1aHash(record.content);
    if (!seen.has(hash)) {
      seen.add(hash);
      kept.push(record);
    }
  }
  return kept;
}

/** Split text into lowercase alphanumeric tokens. */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 0);
}

/**
 * Token shingles of size `shingleSize`, returned as a set of FNV-1a hashes.
 * Texts shorter than one shingle contribute a single whole-text shingle so
 * tiny snippets still compare meaningfully.
 */
export function tokenShingles(text: string, shingleSize = 3): Set<number> {
  const tokens = tokenize(text);
  const shingles = new Set<number>();
  if (tokens.length === 0) {
    return shingles;
  }
  if (tokens.length < shingleSize) {
    shingles.add(fnv1aHash(tokens.join(" ")));
    return shingles;
  }
  for (let i = 0; i + shingleSize <= tokens.length; i += 1) {
    shingles.add(fnv1aHash(tokens.slice(i, i + shingleSize).join(" ")));
  }
  return shingles;
}

/** Jaccard similarity |A∩B| / |A∪B|; two empty sets are identical (1). */
export function jaccardSimilarity(a: Set<number>, b: Set<number>): number {
  if (a.size === 0 && b.size === 0) {
    return 1;
  }
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let intersection = 0;
  for (const value of small) {
    if (large.has(value)) {
      intersection += 1;
    }
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 1 : intersection / union;
}

/** Mix a 32-bit value with a seed (integer avalanche, FNV-style). */
function mix32(value: number, seed: number): number {
  let h = (0x811c9dc5 ^ seed) >>> 0;
  h = (h ^ value) >>> 0;
  h = Math.imul(h, 0x01000193) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 0x85ebca6b) >>> 0;
  h ^= h >>> 13;
  return h >>> 0;
}

/**
 * MinHash-light signature: for each of `size` hash functions (seeded
 * variants of mix32), the minimum hash over all shingles.
 */
function minhashSignature(shingles: Set<number>, size: number): number[] {
  const signature = new Array<number>(size).fill(Number.MAX_SAFE_INTEGER);
  for (const shingle of shingles) {
    for (let i = 0; i < size; i += 1) {
      const h = mix32(shingle, i * 0x9e3779b1);
      if (h < signature[i]) {
        signature[i] = h;
      }
    }
  }
  return signature;
}

export interface NearDedupOptions {
  /** Token-shingle size (default 3). */
  readonly shingleSize?: number;
  /** Number of MinHash functions (default 64). */
  readonly signatureSize?: number;
  /** LSH band count; must divide signatureSize (default 16). */
  readonly bands?: number;
  /** Jaccard threshold at/above which a pair is a near-duplicate (default 0.8). */
  readonly threshold?: number;
}

/**
 * Stage 3b — near-duplicate filtering via MinHash-light banding plus exact
 * Jaccard verification over token shingles. Records sharing an LSH band
 * bucket become candidate pairs; candidates whose true Jaccard similarity
 * reaches `threshold` are duplicates and the later record is dropped. The
 * first occurrence wins; output order follows input order. Method id for the
 * registry: "minhash-light-v1".
 */
export function nearDedup(
  records: readonly DataRecord[],
  options: NearDedupOptions = {},
): DataRecord[] {
  const shingleSize = options.shingleSize ?? 3;
  const signatureSize = options.signatureSize ?? 64;
  const bands = options.bands ?? 16;
  const threshold = options.threshold ?? 0.8;
  if (signatureSize % bands !== 0) {
    throw new Error("signatureSize must be divisible by bands");
  }
  const rowsPerBand = signatureSize / bands;

  const shingleSets = records.map((r) => tokenShingles(r.content, shingleSize));
  const signatures = shingleSets.map((s) => minhashSignature(s, signatureSize));

  // Banding: bucket record indices per band; buckets hold candidate pairs.
  const dropped = new Set<number>();
  const buckets = new Map<string, number[]>();
  for (let index = 0; index < records.length; index += 1) {
    const sig = signatures[index];
    for (let band = 0; band < bands; band += 1) {
      const key = `${band}:${sig.slice(band * rowsPerBand, (band + 1) * rowsPerBand).join(",")}`;
      const bucket = buckets.get(key);
      if (bucket === undefined) {
        buckets.set(key, [index]);
      } else {
        for (const other of bucket) {
          if (!dropped.has(other) && !dropped.has(index)) {
            const similarity = jaccardSimilarity(
              shingleSets[other],
              shingleSets[index],
            );
            if (similarity >= threshold) {
              dropped.add(index);
              break;
            }
          }
        }
        bucket.push(index);
      }
    }
  }
  return records.filter((_, index) => !dropped.has(index));
}

/** Options for eval-set decontamination. */
export interface DecontaminationOptions {
  /** Token n-gram size (default 13, per reuse doc § 3 convention). */
  readonly ngramSize?: number;
}

/** Hash all n-grams of a text into a set (whole-text gram when shorter). */
function ngramHashes(text: string, ngramSize: number): Set<number> {
  const tokens = tokenize(text);
  const hashes = new Set<number>();
  if (tokens.length === 0) {
    return hashes;
  }
  if (tokens.length < ngramSize) {
    hashes.add(fnv1aHash(tokens.join(" ")));
    return hashes;
  }
  for (let i = 0; i + ngramSize <= tokens.length; i += 1) {
    hashes.add(fnv1aHash(tokens.slice(i, i + ngramSize).join(" ")));
  }
  return hashes;
}

/**
 * Stage 4 — decontamination. Removes every record that shares at least one
 * token n-gram (default 13-gram) with any evaluation-set fingerprint text.
 * Eval-set isolation is non-negotiable (spec § 27, reuse doc § 3): the eval
 * sets a dataset was cleaned against must be recorded in
 * `Dataset.decontaminatedAgainst`. Output order follows input order.
 */
export function decontaminate(
  records: readonly DataRecord[],
  evalFingerprints: readonly string[],
  options: DecontaminationOptions = {},
): DataRecord[] {
  const ngramSize = options.ngramSize ?? 13;
  const contaminated = new Set<number>();
  for (const fingerprint of evalFingerprints) {
    for (const hash of ngramHashes(fingerprint, ngramSize)) {
      contaminated.add(hash);
    }
  }
  return records.filter((record) => {
    for (const hash of ngramHashes(record.content, ngramSize)) {
      if (contaminated.has(hash)) {
        return false;
      }
    }
    return true;
  });
}

/** A file of a repository snapshot for stage 6 (repo-level packing). */
export interface RepoFile {
  /** Repository-relative path using "/" separators (e.g. "src/util.ts"). */
  readonly path: string;
  /** File content; import edges are parsed from it. */
  readonly content: string;
}

const IMPORT_PATTERNS: readonly RegExp[] = [
  // JS/TS: import ... from "x"; import "x"; export ... from "x"
  /^\s*(?:import|export)\s[^'"]*?\sfrom\s*["']([^"']+)["']/,
  /^\s*import\s*["']([^"']+)["']/,
  // CommonJS: require("x")
  /\brequire\(\s*["']([^"']+)["']\s*\)/,
  // Python: from x.y import z / import x.y
  /^\s*from\s+([A-Za-z_][\w.]*)\s+import\s/,
  /^\s*import\s+([A-Za-z_][\w.]*)\s*$/,
];

const RESOLVE_EXTENSIONS = [
  "",
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".py",
] as const;

/** Normalize a repo-relative path: forward slashes, no leading "./". */
function normalizePath(path: string): string {
  const parts: string[] = [];
  for (const part of path.replace(/\\/g, "/").split("/")) {
    if (part === "" || part === ".") {
      continue;
    }
    if (part === "..") {
      parts.pop();
    } else {
      parts.push(part);
    }
  }
  return parts.join("/");
}

/** Extract raw import specifiers from file content. */
export function extractImportSpecifiers(content: string): string[] {
  const specifiers: string[] = [];
  for (const line of content.split("\n")) {
    for (const pattern of IMPORT_PATTERNS) {
      const match = pattern.exec(line);
      if (match !== null) {
        specifiers.push(match[1]);
        break;
      }
    }
  }
  return specifiers;
}

/**
 * Resolve an import specifier to a file inside the repo snapshot.
 * Handles relative specifiers ("./util", "../lib"), repo-root-relative and
 * Python dotted specifiers ("pkg.mod" → "pkg/mod.py"), plus directory index
 * files. Returns the normalized repo path or null when external/unknown.
 */
function resolveSpecifier(
  specifier: string,
  fromPath: string,
  knownPaths: ReadonlySet<string>,
): string | null {
  const candidates: string[] = [];
  if (specifier.startsWith(".")) {
    const fromDir = fromPath.includes("/")
      ? fromPath.slice(0, fromPath.lastIndexOf("/"))
      : "";
    candidates.push(normalizePath(`${fromDir}/${specifier}`));
  } else {
    candidates.push(normalizePath(specifier));
    // Python dotted import: "pkg.mod" → "pkg/mod".
    if (/^[A-Za-z_][\w.]*$/.test(specifier) && specifier.includes(".")) {
      candidates.push(normalizePath(specifier.replace(/\./g, "/")));
    }
  }
  for (const candidate of candidates) {
    for (const ext of RESOLVE_EXTENSIONS) {
      if (knownPaths.has(candidate + ext)) {
        return candidate + ext;
      }
      for (const indexExt of RESOLVE_EXTENSIONS) {
        if (
          indexExt !== "" &&
          knownPaths.has(`${candidate}/index${indexExt}`)
        ) {
          return `${candidate}/index${indexExt}`;
        }
      }
    }
  }
  // Bare specifiers may reference project files by suffix (e.g. "src/util").
  for (const candidate of candidates) {
    for (const ext of RESOLVE_EXTENSIONS) {
      const target = candidate + ext;
      for (const known of knownPaths) {
        if (known.endsWith(`/${target}`)) {
          return known;
        }
      }
    }
  }
  return null;
}

/**
 * Stage 6 — repo-level dependency ordering (DeepSeek-Coder methodology,
 * re-implemented from the paper; the original code is not public).
 *
 * Files are ordered so that a file's dependencies appear before the file
 * itself: import edges are parsed from `import`/`require`/`from` lines, the
 * graph is topologically sorted with Kahn's algorithm, ties broken by
 * original order for determinism. Cyclic remainder is appended in original
 * (stable) order — cycles never fail the stage.
 */
export function repoOrder(files: readonly RepoFile[]): RepoFile[] {
  const knownPaths = new Set(files.map((f) => normalizePath(f.path)));
  const edges: Array<Set<number>> = files.map(() => new Set<number>());
  const indexByPath = new Map<string, number>();
  files.forEach((file, index) => {
    indexByPath.set(normalizePath(file.path), index);
  });

  files.forEach((file, index) => {
    for (const specifier of extractImportSpecifiers(file.content)) {
      const resolved = resolveSpecifier(
        specifier,
        normalizePath(file.path),
        knownPaths,
      );
      if (resolved !== null) {
        const depIndex = indexByPath.get(resolved);
        if (depIndex !== undefined && depIndex !== index) {
          // Edge dep → file: the dependency must come first.
          edges[depIndex].add(index);
        }
      }
    }
  });

  // Kahn's algorithm with deterministic (original-order) tie-breaking.
  const indegree = files.map((_, index) =>
    edges.reduce((count, targets) => count + (targets.has(index) ? 1 : 0), 0),
  );
  const available: number[] = [];
  files.forEach((_, index) => {
    if (indegree[index] === 0) {
      available.push(index);
    }
  });
  const ordered: number[] = [];
  const placed = new Set<number>();
  while (available.length > 0) {
    // Pick the smallest original index for a stable, deterministic order.
    let pick = 0;
    for (let i = 1; i < available.length; i += 1) {
      if (available[i] < available[pick]) {
        pick = i;
      }
    }
    const current = available.splice(pick, 1)[0];
    if (placed.has(current)) {
      continue;
    }
    placed.add(current);
    ordered.push(current);
    for (const target of edges[current]) {
      indegree[target] -= 1;
      if (indegree[target] === 0 && !placed.has(target)) {
        available.push(target);
      }
    }
  }
  // Stable fallback for cyclic nodes: keep original relative order.
  files.forEach((_, index) => {
    if (!placed.has(index)) {
      ordered.push(index);
    }
  });
  return ordered.map((index) => files[index]);
}
