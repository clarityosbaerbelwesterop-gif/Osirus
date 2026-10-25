import "server-only";

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export class ModelResponseCache {
  private cache = new Map<string, CacheEntry<unknown>>();
  private readonly defaultTtl: number;
  private readonly maxSize: number;

  constructor(options: { defaultTtlMs?: number; maxSize?: number } = {}) {
    this.defaultTtl = options.defaultTtlMs ?? 5 * 60 * 1000;
    this.maxSize = options.maxSize ?? 1000;
  }

  private generateKey(
    model: string,
    messages: unknown[],
    options: Record<string, unknown> = {},
  ): string {
    const content = JSON.stringify({ model, messages, options });
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      hash = ((hash << 5) - hash + content.charCodeAt(i)) | 0;
    }
    return `model:${Math.abs(hash).toString(36)}`;
  }

  get<T>(
    model: string,
    messages: unknown[],
    options: Record<string, unknown> = {},
  ): T | null {
    const key = this.generateKey(model, messages, options);
    const entry = this.cache.get(key) as CacheEntry<T> | undefined;

    if (!entry) return null;

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }

    return entry.value;
  }

  set<T>(
    model: string,
    messages: unknown[],
    value: T,
    options: Record<string, unknown> = {},
    ttlMs?: number,
  ): void {
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) this.cache.delete(firstKey);
    }

    const key = this.generateKey(model, messages, options);
    this.cache.set(key, {
      value,
      expiresAt: Date.now() + (ttlMs ?? this.defaultTtl),
    });
  }

  delete(
    model: string,
    messages: unknown[],
    options: Record<string, unknown> = {},
  ): boolean {
    const key = this.generateKey(model, messages, options);
    return this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
  }

  size(): number {
    return this.cache.size;
  }

  pruneExpired(): number {
    const now = Date.now();
    let count = 0;
    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiresAt) {
        this.cache.delete(key);
        count++;
      }
    }
    return count;
  }
}

export const modelResponseCache = new ModelResponseCache({
  defaultTtlMs: 5 * 60 * 1000,
  maxSize: 1000,
});

setInterval(() => {
  modelResponseCache.pruneExpired();
}, 60 * 1000);