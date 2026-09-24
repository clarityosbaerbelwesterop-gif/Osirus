import { createHash } from "node:crypto";

/** Deterministic PRNG (mulberry32) so generated suites are reproducible. */
export function rng(seed: number) {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (min: number, max: number) =>
      min + Math.floor(next() * (max - min + 1)),
    pick: <T>(items: readonly T[]) => items[Math.floor(next() * items.length)]!,
  };
}

export function seedOf(text: string) {
  return createHash("sha256").update(text).digest().readUInt32BE(0);
}

/** Content fingerprint: whitespace- and case-insensitive. */
export function fingerprint(...parts: unknown[]) {
  const normalized = parts
    .map((part) =>
      typeof part === "string" ? part : JSON.stringify(part ?? null),
    )
    .join("␞")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
  return createHash("sha256").update(normalized).digest("hex").slice(0, 32);
}

/**
 * 64-bit SimHash over word shingles, as a hex string. Near-duplicate texts
 * differ in few bits; `hamming` measures by how many.
 */
export function simhash(text: string) {
  const words = text.toLowerCase().match(/[a-z0-9_]+/g) ?? [];
  const weights = new Array<number>(64).fill(0);
  for (let index = 0; index + 1 < Math.max(2, words.length); index += 1) {
    const shingle = `${words[index] ?? ""} ${words[index + 1] ?? ""}`;
    const digest = createHash("sha256").update(shingle).digest();
    for (let bit = 0; bit < 64; bit += 1) {
      const byte = digest[bit >> 3]!;
      weights[bit]! += (byte >> (bit & 7)) & 1 ? 1 : -1;
    }
  }
  let hex = "";
  for (let nibble = 0; nibble < 16; nibble += 1) {
    let value = 0;
    for (let bit = 0; bit < 4; bit += 1)
      if (weights[nibble * 4 + bit]! > 0) value |= 1 << bit;
    hex += value.toString(16);
  }
  return hex;
}

export function hamming(a: string, b: string) {
  let distance = 0;
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    let x = parseInt(a[index]!, 16) ^ parseInt(b[index]!, 16);
    while (x) {
      distance += x & 1;
      x >>= 1;
    }
  }
  return distance + Math.abs(a.length - b.length) * 4;
}
