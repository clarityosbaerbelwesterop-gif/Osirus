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
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part)))
    return true;
  const [a, b] = parts as [number, number, number, number];
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

/** Loopback, private, link-local, CGNAT, multicast and reserved ranges. */
export function isPrivateAddress(address: string) {
  const family = isIP(address);
  if (family === 4) return ipv4Private(address);
  if (family !== 6) return true;
  const value = address.toLowerCase();
  const mapped = value.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return ipv4Private(mapped[1]!);
  return (
    value === "::" ||
    value === "::1" ||
    /^f[cd]/.test(value) ||
    /^fe[89ab]/.test(value) ||
    /^ff/.test(value) ||
    value.startsWith("64:ff9b:") ||
    value.startsWith("2001:db8")
  );
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
  const host = url.hostname.replace(/^\[|\]$/g, "");
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
