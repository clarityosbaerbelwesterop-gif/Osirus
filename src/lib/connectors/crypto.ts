import {
  createCipheriv,
  createDecipheriv,
  createHash,
  hkdfSync,
  randomBytes,
} from "node:crypto";

import { env } from "@/lib/env";

// Connector credentials at rest (GitHub and platform tokens, MCP keys,
// webhook signing secrets).
//
// AES-256-GCM with a key that lives only in the app runtime's environment
// (OSIRUS_CONNECTOR_KEY). The database holds ciphertext; a database dump
// without the key yields no usable token, and the key is never in the
// database, a log, a prompt or the browser.
//
// v2 (audit 2026-11-17):
// - Each purpose seals with its own key, derived with HKDF-SHA256, instead
//   of one SHA-256 of the raw secret for everything.
// - The workspace and purpose are authenticated data: a sealed GitHub token
//   copied into another workspace's row, or into an MCP row, does not open.
// - A key id names the key that sealed, so the key can be rotated: move the
//   old one to OSIRUS_CONNECTOR_KEY_PREVIOUS, set a new one, and everything
//   still opens; the scheduler re-seals old rows with the new key.
// v1 values (no context) still open, and are re-sealed as v2.

const V1 = "v1";
const V2 = "v2";

export type SecretPurpose =
  | "connector:github"
  | "connector:vercel"
  | "connector:neon"
  | "connector:supabase"
  | "mcp"
  | "mcp-url"
  | "webhook";

export type SecretContext = { purpose: SecretPurpose; workspaceId: string };

type Key = { raw: string; id: string };

function keys(): { current: Key | null; previous: Key | null } {
  const make = (raw: string | undefined): Key | null =>
    raw && raw.length >= 32
      ? {
          raw,
          id: createHash("sha256")
            .update(`osirus-key-id:${raw}`, "utf8")
            .digest("base64url")
            .slice(0, 8),
        }
      : null;
  return {
    current: make(env.OSIRUS_CONNECTOR_KEY),
    previous: make(env.OSIRUS_CONNECTOR_KEY_PREVIOUS),
  };
}

function v1Key(raw: string) {
  // v1: a hash of the raw secret, the same for every purpose.
  return createHash("sha256").update(raw, "utf8").digest();
}

function v2Key(raw: string, purpose: SecretPurpose) {
  return Buffer.from(
    hkdfSync("sha256", raw, "osirus/connector-secret", `v2:${purpose}`, 32),
  );
}

function aad(context: SecretContext) {
  return Buffer.from(
    `osirus:${context.purpose}:${context.workspaceId}`,
    "utf8",
  );
}

export function connectorKeyConfigured() {
  return keys().current !== null;
}

export function encryptSecret(plaintext: string, context: SecretContext) {
  const current = keys().current;
  if (!current) throw new Error("connector_key_not_configured");
  const iv = randomBytes(12);
  const cipher = createCipheriv(
    "aes-256-gcm",
    v2Key(current.raw, context.purpose),
    iv,
  );
  cipher.setAAD(aad(context));
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  return [
    V2,
    current.id,
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

function open(
  key: Buffer,
  iv: string,
  tag: string,
  ciphertext: string,
  associated: Buffer | null,
) {
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(iv, "base64url"),
  );
  if (associated) decipher.setAAD(associated);
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

export function decryptSecret(sealed: string, context: SecretContext) {
  const { current, previous } = keys();
  if (!current) throw new Error("connector_key_not_configured");
  const parts = sealed.split(".");
  if (parts[0] === V2) {
    const [, keyId, iv, tag, ciphertext] = parts;
    if (!keyId || !iv || !tag || !ciphertext || parts.length !== 5)
      throw new Error("sealed_secret_malformed");
    const key = [current, previous].find((entry) => entry?.id === keyId);
    if (!key) throw new Error("sealed_secret_unknown_key");
    return open(
      v2Key(key.raw, context.purpose),
      iv,
      tag,
      ciphertext,
      aad(context),
    );
  }
  if (parts[0] === V1) {
    const [, iv, tag, ciphertext] = parts;
    if (!iv || !tag || !ciphertext || parts.length !== 4)
      throw new Error("sealed_secret_malformed");
    // v1 carries no key id: the current key, then the previous one.
    for (const key of [current, previous]) {
      if (!key) continue;
      try {
        return open(v1Key(key.raw), iv, tag, ciphertext, null);
      } catch {
        // try the next key
      }
    }
    throw new Error("sealed_secret_unreadable");
  }
  throw new Error("sealed_secret_malformed");
}

/**
 * True when a sealed value should be sealed again: v1, or v2 under a key
 * that is no longer the current one.
 */
export function needsReseal(sealed: string) {
  const parts = sealed.split(".");
  if (parts[0] === V1) return true;
  return parts[0] === V2 && parts[1] !== keys().current?.id;
}
