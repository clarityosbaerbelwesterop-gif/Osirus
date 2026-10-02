/**
 * AI Lab — shared append-only JSONL store backing the Phase H registries.
 *
 * One line per record, written with `appendFileSync` (never rewritten), plus an
 * in-memory index rebuilt from the file on construction. No external
 * dependencies, no database, no network — the store is a plain local file, so
 * the lab tree stays severable (ai-lab/ARCHITECTURE.md § 0).
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";

/** Raised for validation failures, duplicate ids, and corrupt store files. */
export class RegistryError extends Error {
  /** Human-readable contract violations, when the failure is validation. */
  readonly errors: readonly string[];

  constructor(message: string, errors: readonly string[] = []) {
    super(message);
    this.name = "RegistryError";
    this.errors = errors;
  }
}

interface JsonlStoreOptions<T extends { readonly id: string }> {
  /** Path of the append-only JSONL file (created lazily on first register). */
  readonly filePath: string;
  /** Contract validator: returns human-readable errors, empty means valid. */
  readonly validate: (value: unknown) => string[];
  /** Registry name for error messages (e.g. "dataset"). */
  readonly kind: string;
  /** Extra integrity check run after contract validation (e.g. lineage). */
  readonly checkIntegrity?: (record: T, store: JsonlStore<T>) => string[];
}

/**
 * Append-only record store keyed by `id`. Records are immutable once
 * registered; corrections happen by registering a new record, never by
 * editing history (the audit-trail reading of the migration-ledger pattern).
 */
export class JsonlStore<T extends { readonly id: string }> {
  private readonly filePath: string;
  private readonly validate: (value: unknown) => string[];
  private readonly kind: string;
  private readonly checkIntegrity?: (
    record: T,
    store: JsonlStore<T>,
  ) => string[];
  private readonly index = new Map<string, T>();

  constructor(options: JsonlStoreOptions<T>) {
    this.filePath = options.filePath;
    this.validate = options.validate;
    this.kind = options.kind;
    this.checkIntegrity = options.checkIntegrity;
    this.load();
  }

  /** Rebuild the in-memory index from the JSONL file, if it exists. */
  private load(): void {
    if (!existsSync(this.filePath)) {
      return;
    }
    const lines = readFileSync(this.filePath, "utf8").split("\n");
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i].trim();
      if (line === "") {
        continue;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        throw new RegistryError(
          `${this.kind} registry file is corrupt: line ${i + 1} is not valid JSON`,
        );
      }
      const errors = this.validate(parsed);
      if (errors.length > 0) {
        throw new RegistryError(
          `${this.kind} registry file is corrupt: line ${i + 1} fails the contract (${errors.join("; ")})`,
          errors,
        );
      }
      const record = parsed as T;
      if (this.index.has(record.id)) {
        throw new RegistryError(
          `${this.kind} registry file is corrupt: duplicate id "${record.id}" at line ${i + 1}`,
        );
      }
      this.index.set(record.id, record);
    }
  }

  /** Number of registered records. */
  get size(): number {
    return this.index.size;
  }

  /** True when a record with this id exists. */
  has(id: string): boolean {
    return this.index.has(id);
  }

  /** Fetch a record by id, or `undefined` when absent. */
  get(id: string): T | undefined {
    return this.index.get(id);
  }

  /**
   * All records in registration order, optionally narrowed by `filter`
   * (a predicate over the stored record).
   */
  list(filter?: (record: T) => boolean): T[] {
    const all = [...this.index.values()];
    return filter ? all.filter((r) => filter(r)) : all;
  }

  /**
   * Validate and append a record. Throws `RegistryError` on contract
   * violations, integrity-rule violations, or a duplicate id — the store is
   * append-only, so re-registration of an id is always rejected.
   */
  register(record: T): T {
    const errors = this.validate(record);
    if (errors.length > 0) {
      throw new RegistryError(
        `invalid ${this.kind} record "${typeof record?.id === "string" ? record.id : "?"}": ${errors.join("; ")}`,
        errors,
      );
    }
    if (this.index.has(record.id)) {
      throw new RegistryError(
        `duplicate ${this.kind} id "${record.id}": ids are append-only and cannot be re-registered`,
      );
    }
    if (this.checkIntegrity) {
      const integrityErrors = this.checkIntegrity(record, this);
      if (integrityErrors.length > 0) {
        throw new RegistryError(
          `${this.kind} record "${record.id}" violates registry integrity: ${integrityErrors.join("; ")}`,
          integrityErrors,
        );
      }
    }
    mkdirSync(dirname(this.filePath), { recursive: true });
    appendFileSync(this.filePath, `${JSON.stringify(record)}\n`, "utf8");
    this.index.set(record.id, record);
    return record;
  }
}
