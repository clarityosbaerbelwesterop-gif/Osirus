import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { Agent, fetch as undiciFetch } from "undici";
import {
  guardedLookup,
  isPrivateAddress,
  OutboundBlockedError,
} from "../security/outbound";
import { researchUserAgent } from "./site-url";

export { isPrivateAddress };

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
          "user-agent": researchUserAgent(),
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
  const point = (value: number) =>
    Number.isInteger(value) && value > 0 && value <= 0x10ffff
      ? String.fromCodePoint(value)
      : " ";
  return text.replace(
    /&(#x?[0-9a-f]{1,8}|\w{1,32});/gi,
    (whole, code: string) => {
      if (code.startsWith("#x") || code.startsWith("#X"))
        return point(parseInt(code.slice(2), 16));
      if (code.startsWith("#")) return point(Number(code.slice(1)));
      return ENTITIES[code.toLowerCase()] ?? whole;
    },
  );
}

// Everything below scans the page once with indexOf. Regexes such as
// /<!--[\s\S]*?-->/ or /<[^>]+>/ take quadratic time on a page made of
// thousands of unclosed "<!--" or "<" (measured: 512 KB took 34 s), and a
// synchronous regex cannot be stopped by any timeout.

const DROPPED_BLOCKS = [
  "script",
  "style",
  "noscript",
  "svg",
  "nav",
  "footer",
  "header",
  "form",
  "iframe",
  "template",
];
const BREAK_TAGS = new Set(["br", "/p", "/div", "/li", "/tr"]);

function isNameChar(char: string | undefined) {
  return char !== undefined && /[a-z0-9:-]/i.test(char);
}

/** Tag name right after "<" at `at` (lowercase, with a leading "/"), or "". */
function tagNameAt(lower: string, at: number) {
  let end = at + 1;
  if (lower[end] === "/") end += 1;
  while (end < lower.length && end - at < 40 && isNameChar(lower[end]))
    end += 1;
  return lower.slice(at + 1, end);
}

function stripMarkup(html: string) {
  const lower = html.toLowerCase();
  let out = "";
  let at = 0;
  while (at < html.length) {
    const open = html.indexOf("<", at);
    if (open < 0) {
      out += html.slice(at);
      break;
    }
    out += html.slice(at, open);
    if (html.startsWith("<!--", open)) {
      const close = html.indexOf("-->", open + 4);
      out += " ";
      if (close < 0) break;
      at = close + 3;
      continue;
    }
    const name = tagNameAt(lower, open);
    if (!name.replace("/", "") && !/[!?]/.test(html[open + 1] ?? "")) {
      // "<" not starting a tag ("a < b") is text.
      out += "<";
      at = open + 1;
      continue;
    }
    if (DROPPED_BLOCKS.includes(name)) {
      const close = lower.indexOf(`</${name}`, open + name.length + 1);
      out += " ";
      if (close < 0) break;
      const end = html.indexOf(">", close);
      if (end < 0) break;
      at = end + 1;
      continue;
    }
    const end = html.indexOf(">", open + 1);
    if (end < 0) {
      // A lone "<" in text: keep the rest as text.
      out += html.slice(open);
      break;
    }
    out += BREAK_TAGS.has(name) || /^\/h\d$/.test(name) ? "\n" : " ";
    at = end + 1;
  }
  return out;
}

function attributes(tag: string) {
  const found: Record<string, string> = {};
  for (const match of tag.matchAll(/([\w:.-]{1,60})\s*=\s*("[^"]*"|'[^']*')/g))
    found[match[1]!.toLowerCase()] = match[2]!.slice(1, -1);
  return found;
}

/** Every <meta> tag's name/property → content, first one wins. */
function metaTags(html: string, lower: string) {
  const metas = new Map<string, string>();
  let at = 0;
  while (metas.size < 200) {
    const open = lower.indexOf("<meta", at);
    if (open < 0) break;
    const end = html.indexOf(">", open);
    if (end < 0) break;
    const attrs = attributes(html.slice(open, end));
    const key = (attrs.property ?? attrs.name ?? "").toLowerCase();
    if (key && attrs.content && !metas.has(key)) metas.set(key, attrs.content);
    at = end + 1;
  }
  return metas;
}

function titleOf(html: string, lower: string) {
  const open = lower.indexOf("<title");
  if (open < 0) return "";
  const start = html.indexOf(">", open);
  if (start < 0) return "";
  const close = lower.indexOf("</title", start);
  return html.slice(start + 1, close < 0 ? start + 1 : close).trim();
}

/**
 * HTML to readable text. Scripts, styles, navigation and forms are dropped
 * before any text is kept, so markup a page hides from readers does not reach
 * the model either.
 */
export function htmlToText(html: string) {
  const lower = html.toLowerCase();
  const metas = metaTags(html, lower);
  const meta = (name: string) => metas.get(name);
  const title = decodeEntities(titleOf(html, lower));
  const text = decodeEntities(stripMarkup(html))
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/\n[ \t]*(?:\n[ \t]*)+/g, "\n\n")
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
