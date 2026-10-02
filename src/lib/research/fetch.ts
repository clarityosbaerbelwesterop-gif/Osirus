import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { Agent, fetch as undiciFetch } from "undici";
import { guardedLookup, OutboundBlockedError } from "../security/outbound";

// Fetching the open web, safely.
//
// A research agent fetches URLs that a model chose, often from text a web page
// supplied. That is a server-side request forgery surface: without a guard,
// "fetch http://169.254.169.254/latest/meta-data" is one tool call away. Every
// hop is resolved and checked before it is requested, redirects are followed
// by hand so each target is checked too, and the response is size-capped.
//
// The DNS check runs twice by design: once when the URL is read
// (assertPublicUrl) and again when the connection is made, through the same
// guardedLookup dispatcher src/lib/security/outbound.ts uses, so a DNS answer
// that flips between check and connect (rebinding) is still refused.
//
// Stated rather than hidden: http:// stays allowed (research sources include
// plain-http pages); the guard is about *where* the connection goes, not the
// transport's confidentiality.

const MAX_BYTES = 2_000_000;
const TIMEOUT_MS = 12_000;
const MAX_REDIRECTS = 3;

// The connect-time DNS guard. The lookup hook re-resolves the hostname when
// the socket is opened and refuses to hand a private address to it, closing
// the check-then-connect window a rebinding attack would use.
const agent = new Agent({
  connect: { lookup: guardedLookup as never, timeout: 10_000 },
  headersTimeout: TIMEOUT_MS,
  bodyTimeout: TIMEOUT_MS,
});

export class FetchRefused extends Error {
  constructor(reason: string) {
    super(`fetch_refused:${reason}`);
    this.name = "FetchRefused";
  }
}

function privateV4(address: string) {
  const [a, b] = address.split(".").map(Number) as [number, number];
  return (
    a === 10 ||
    a === 127 ||
    a === 0 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    a >= 224
  );
}

function privateV6(address: string) {
  const lower = address.toLowerCase();
  if (lower === "::1" || lower === "::") return true;
  if (
    lower.startsWith("fe80") ||
    lower.startsWith("fc") ||
    lower.startsWith("fd")
  )
    return true;
  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  return mapped ? privateV4(mapped[1]!) : false;
}

export function isPrivateAddress(address: string) {
  const family = isIP(address);
  if (family === 4) return privateV4(address);
  if (family === 6) return privateV6(address);
  return true;
}

export async function assertPublicUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new FetchRefused("invalid_url");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:")
    throw new FetchRefused("scheme_not_allowed");
  if (url.username || url.password)
    throw new FetchRefused("credentials_in_url");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".internal")
  ) {
    throw new FetchRefused("private_host");
  }
  const addresses = isIP(host)
    ? [{ address: host }]
    : await lookup(host, { all: true }).catch(() => []);
  if (addresses.length === 0) throw new FetchRefused("host_does_not_resolve");
  if (addresses.some(({ address }) => isPrivateAddress(address)))
    throw new FetchRefused("private_address");
  return url;
}

export type FetchedPage = {
  url: string;
  finalUrl: string;
  status: number;
  contentType: string;
  body: string;
  bytes: number;
  retrievedAt: string;
};

export async function safeFetch(
  raw: string,
  options: { signal?: AbortSignal; accept?: string } = {},
): Promise<FetchedPage> {
  let url = await assertPublicUrl(raw);
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error("fetch_timeout")),
    TIMEOUT_MS,
  );
  options.signal?.addEventListener(
    "abort",
    () => controller.abort(options.signal?.reason),
    { once: true },
  );
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      const response = await undiciFetch(url, {
        redirect: "manual",
        signal: controller.signal,
        dispatcher: agent,
        headers: {
          "user-agent": "OsirusResearch/1.0 (+https://osirus.vercel.app)",
          accept:
            options.accept ??
            "text/html,application/json,text/plain;q=0.9,*/*;q=0.5",
        },
      }).catch((error: unknown) => {
        // A connect-time refusal (the DNS answer was private, e.g. after a
        // rebinding) arrives wrapped as "fetch failed". Surface it as the
        // refusal it is, in this layer's own error type.
        const cause = (error as { cause?: unknown })?.cause;
        if (cause instanceof OutboundBlockedError)
          throw new FetchRefused(cause.reason);
        throw error;
      });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) throw new FetchRefused("redirect_without_location");
        url = await assertPublicUrl(new URL(location, url).toString());
        continue;
      }
      const reader = response.body?.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > MAX_BYTES) {
            await reader.cancel();
            break;
          }
          chunks.push(value);
        }
      }
      const bytes = new Uint8Array(Math.min(size, MAX_BYTES));
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(
          chunk.subarray(0, Math.max(0, bytes.length - offset)),
          offset,
        );
        offset += chunk.byteLength;
        if (offset >= bytes.length) break;
      }
      return {
        url: raw,
        finalUrl: url.toString(),
        status: response.status,
        contentType: response.headers.get("content-type") ?? "",
        body: new TextDecoder("utf-8", { fatal: false }).decode(bytes),
        bytes: bytes.length,
        retrievedAt: new Date().toISOString(),
      };
    }
    throw new FetchRefused("too_many_redirects");
  } finally {
    clearTimeout(timer);
  }
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

export function decodeEntities(text: string) {
  return text.replace(/&(#x?[0-9a-f]+|\w+);/gi, (whole, code: string) => {
    if (code.startsWith("#x") || code.startsWith("#X"))
      return String.fromCodePoint(parseInt(code.slice(2), 16) || 32);
    if (code.startsWith("#"))
      return String.fromCodePoint(Number(code.slice(1)) || 32);
    return ENTITIES[code.toLowerCase()] ?? whole;
  });
}

/**
 * HTML to readable text. Scripts, styles, navigation and forms are dropped
 * before any text is kept, so markup a page hides from readers does not reach
 * the model either.
 */
export function htmlToText(html: string) {
  const meta = (name: string) =>
    html.match(
      new RegExp(
        `<meta[^>]+(?:property|name)=["']${name}["'][^>]*content=["']([^"']+)["']`,
        "i",
      ),
    )?.[1] ??
    html.match(
      new RegExp(
        `<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["']${name}["']`,
        "i",
      ),
    )?.[1];
  const title = decodeEntities(
    html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() ?? "",
  );
  const cleaned = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(
      /<(script|style|noscript|svg|nav|footer|header|form|iframe|template)[\s\S]*?<\/\1>/gi,
      " ",
    )
    .replace(/<(br|\/p|\/div|\/li|\/h\d|\/tr)[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  const text = decodeEntities(cleaned)
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/\n\s*\n+/g, "\n\n")
    .trim();
  return {
    title: title || meta("og:title") || "",
    publisher: meta("og:site_name") ?? null,
    publishedAt:
      meta("article:published_time") ?? meta("date") ?? meta("dc.date") ?? null,
    text,
  };
}

export function contentHash(text: string) {
  return createHash("sha256").update(text).digest("hex");
}
