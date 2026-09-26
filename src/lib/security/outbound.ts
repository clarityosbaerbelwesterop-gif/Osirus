import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { isIP } from "node:net";
import { Agent, fetch as undiciFetch } from "undici";

// Outbound requests to addresses a user supplied (MCP servers).
//
// A URL typed by a person can point anywhere the server can reach: its own
// loopback, the cloud metadata endpoint, a private network. So a user-supplied
// URL must be https, carry no credentials, and resolve only to public
// addresses -- checked when the connection is made, not just when the URL is
// read, so a DNS answer that changes between check and connect (rebinding)
// is still refused. Redirects are not followed.

export class OutboundBlockedError extends Error {
  constructor(readonly reason: string) {
    super(`outbound_blocked:${reason}`);
  }
}

function ipv4Private(address: string) {
  const parts = address.split(".").map(Number);
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  )
    return true;
  const [a, b, c] = parts as [number, number, number, number];
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 88 && c === 99) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224
  );
}

/**
 * An IPv6 address as eight 16-bit groups, or null when it is not one.
 * Handles "::" compression and a dotted IPv4 tail ("::ffff:127.0.0.1").
 */
function ipv6Groups(address: string): number[] | null {
  let value = address.toLowerCase().split("%")[0]!;
  const tail = value.match(/:(\d+\.\d+\.\d+\.\d+)$/);
  if (tail) {
    const octets = tail[1]!.split(".").map(Number);
    if (octets.some((octet) => !(octet >= 0 && octet <= 255))) return null;
    value =
      value.slice(0, -tail[1]!.length) +
      ((octets[0]! << 8) | octets[1]!).toString(16) +
      ":" +
      ((octets[2]! << 8) | octets[3]!).toString(16);
  }
  const halves = value.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - rest.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const groups = [...head, ...Array<string>(missing).fill("0"), ...rest].map(
    (group) => (/^[0-9a-f]{1,4}$/.test(group) ? parseInt(group, 16) : NaN),
  );
  return groups.some(Number.isNaN) ? null : groups;
}

const embeddedIpv4 = (high: number, low: number) =>
  `${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`;

function ipv6Private(address: string) {
  const g = ipv6Groups(address);
  if (!g) return true;
  const zeroPrefix = (count: number) =>
    g.slice(0, count).every((group) => group === 0);
  // Unspecified and loopback.
  if (zeroPrefix(7) && (g[7] === 0 || g[7] === 1)) return true;
  // Addresses that carry an IPv4 address and reach it: IPv4-mapped
  // (::ffff:a.b.c.d), IPv4-compatible (::a.b.c.d), IPv4-translated
  // (::ffff:0:a.b.c.d) and NAT64 (64:ff9b::a.b.c.d). The URL parser writes
  // these in hex ("[::ffff:7f00:1]"), so they are judged by the IPv4 inside.
  if (zeroPrefix(5) && g[5] === 0xffff)
    return ipv4Private(embeddedIpv4(g[6]!, g[7]!));
  if (zeroPrefix(6)) return ipv4Private(embeddedIpv4(g[6]!, g[7]!));
  if (zeroPrefix(4) && g[4] === 0xffff && g[5] === 0)
    return ipv4Private(embeddedIpv4(g[6]!, g[7]!));
  if (g[0] === 0x64 && g[1] === 0xff9b) return true;
  // 6to4 (2002::/16) embeds an IPv4 address in groups 1-2; Teredo
  // (2001:0::/32) tunnels to an arbitrary one. Neither is a normal server.
  if (g[0] === 0x2002) return true;
  if (g[0] === 0x2001 && g[1] === 0) return true;
  // Documentation (2001:db8::/32) and discard (100::/64).
  if (g[0] === 0x2001 && g[1] === 0xdb8) return true;
  if (g[0] === 0x100 && g[1] === 0 && g[2] === 0 && g[3] === 0) return true;
  const first = g[0]!;
  return (
    // Unique local fc00::/7.
    (first & 0xfe00) === 0xfc00 ||
    // Link-local fe80::/10 and the deprecated site-local fec0::/10.
    (first & 0xffc0) === 0xfe80 ||
    (first & 0xffc0) === 0xfec0 ||
    // Multicast ff00::/8.
    (first & 0xff00) === 0xff00
  );
}

/**
 * Loopback, private, link-local, CGNAT, multicast, documentation and reserved
 * ranges, in IPv4 and IPv6, including IPv6 forms that embed an IPv4 address.
 * Anything that does not parse as an IP address counts as private.
 */
export function isPrivateAddress(address: string) {
  const family = isIP(address);
  if (family === 4) return ipv4Private(address);
  if (family === 6) return ipv6Private(address);
  return true;
}

const BLOCKED_HOSTS = /(^|\.)(localhost|local|internal|localdomain|home|lan)$/i;

/** Validate a user-supplied URL before any connection is attempted. */
export function checkOutboundUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new OutboundBlockedError("invalid_url");
  }
  if (url.protocol !== "https:") throw new OutboundBlockedError("not_https");
  if (url.username || url.password)
    throw new OutboundBlockedError("credentials_in_url");
  // A trailing dot is the same name ("localhost." is localhost).
  const host = url.hostname.replace(/^\[|\]$/g, "").replace(/\.+$/, "");
  if (!host || BLOCKED_HOSTS.test(host))
    throw new OutboundBlockedError("private_host");
  if (isIP(host) && isPrivateAddress(host))
    throw new OutboundBlockedError("private_address");
  if (
    url.port &&
    !["443", "8443"].includes(url.port) &&
    Number(url.port) < 1024
  )
    throw new OutboundBlockedError("port_not_allowed");
  return url;
}

type LookupCallback = (
  error: NodeJS.ErrnoException | null,
  address: string | LookupAddress[],
  family?: number,
) => void;

/** DNS lookup that refuses to hand a private address to the socket. */
export function guardedLookup(
  hostname: string,
  options: { all?: boolean; family?: number },
  callback: LookupCallback,
) {
  dnsLookup(hostname, { ...options, all: true }, (error, addresses) => {
    if (error) return callback(error, []);
    const list = addresses as LookupAddress[];
    if (!list.length || list.some((entry) => isPrivateAddress(entry.address)))
      return callback(new OutboundBlockedError("private_address"), []);
    if (options.all) return callback(null, list);
    return callback(null, list[0]!.address, list[0]!.family);
  });
}

const agent = new Agent({
  connect: { lookup: guardedLookup as never, timeout: 10_000 },
  headersTimeout: 15_000,
  bodyTimeout: 15_000,
});

/**
 * Fetch a user-supplied https URL with the checks above, a timeout and a
 * response size cap. Returns the status, headers and body text.
 */
export async function outboundFetch(
  raw: string,
  init: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
    timeoutMs?: number;
    maxBytes?: number;
  } = {},
) {
  const url = checkOutboundUrl(raw);
  const timeout = AbortSignal.timeout(init.timeoutMs ?? 15_000);
  const signal = init.signal
    ? AbortSignal.any([init.signal, timeout])
    : timeout;
  const response = await undiciFetch(url, {
    method: init.method ?? "GET",
    headers: init.headers,
    body: init.body,
    redirect: "manual",
    signal,
    dispatcher: agent,
  }).catch((error: unknown) => {
    // A refusal at connect time (the DNS answer was private, e.g. after a
    // rebinding) arrives wrapped as "fetch failed". Surface it as the block
    // it is, so it is reported and recorded as one.
    const cause = (error as { cause?: unknown })?.cause;
    if (cause instanceof OutboundBlockedError) throw cause;
    throw error;
  });
  if (response.status >= 300 && response.status < 400)
    throw new OutboundBlockedError("redirect_not_followed");
  const limit = init.maxBytes ?? 1_000_000;
  const reader = response.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (reader) {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new OutboundBlockedError("response_too_large");
      }
      chunks.push(value);
    }
  }
  const text = Buffer.concat(chunks).toString("utf8");
  return { status: response.status, headers: response.headers, text };
}
