import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

// Connector credentials at rest.
//
// AES-256-GCM with a key that lives only in the app runtime's environment
// (OSIRUS_CONNECTOR_KEY). The database holds ciphertext; a database dump
// without the key yields no usable token, and the key is never in the
// database, a log, a prompt or the browser.

const VERSION = "v1";

function key() {
  const raw = process.env.OSIRUS_CONNECTOR_KEY;
  if (!raw || raw.length < 32) return null;
  // Hashing accepts any sufficiently long secret string and always yields the
  // 32 bytes AES-256 needs.
  return createHash("sha256").update(raw, "utf8").digest();
}

export function connectorKeyConfigured() {
  return key() !== null;
}

export function encryptSecret(plaintext: string) {
  const secret = key();
  if (!secret) throw new Error("connector_key_not_configured");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", secret, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv, tag, ciphertext]
    .map((part) =>
      typeof part === "string" ? part : part.toString("base64url"),
    )
    .join(".");
}

export function decryptSecret(sealed: string) {
  const secret = key();
  if (!secret) throw new Error("connector_key_not_configured");
  const [version, iv, tag, ciphertext] = sealed.split(".");
  if (version !== VERSION || !iv || !tag || !ciphertext)
    throw new Error("sealed_secret_malformed");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    secret,
    Buffer.from(iv, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}
