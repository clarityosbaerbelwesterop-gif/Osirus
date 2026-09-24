import "server-only";

// The official MCP Registry (registry.modelcontextprotocol.io), searched live.
// Only servers that publish a remote Streamable HTTP endpoint can be added
// here; servers that only ship a local (stdio) package are listed with that
// said plainly, because Osirus cannot run them. Nothing about a server is
// guessed or hardcoded: names, descriptions and URLs come from the registry,
// and the server's own tools are still reviewed one by one after adding it.

export type RegistryServer = {
  name: string;
  title: string | null;
  description: string;
  remoteUrl: string | null;
  localOnly: boolean;
  repository: string | null;
};

const BASE = "https://registry.modelcontextprotocol.io/v0/servers";
const cache = new Map<string, { at: number; servers: RegistryServer[] }>();

const str = (value: unknown) =>
  typeof value === "string" && value.trim() ? value.trim() : null;

export function parseRegistry(data: unknown): RegistryServer[] {
  const entries = Array.isArray((data as { servers?: unknown })?.servers)
    ? ((data as { servers: unknown[] }).servers as unknown[])
    : [];
  const out: RegistryServer[] = [];
  for (const entry of entries) {
    const server = ((entry as { server?: unknown }).server ?? entry) as Record<
      string,
      unknown
    >;
    const name = str(server.name);
    if (!name) continue;
    const remotes = Array.isArray(server.remotes)
      ? (server.remotes as Array<Record<string, unknown>>)
      : [];
    const remote = remotes.find(
      (item) =>
        item.type === "streamable-http" &&
        typeof item.url === "string" &&
        /^https:\/\//.test(item.url) &&
        // Templated URLs need values Osirus does not have.
        !/[{}]/.test(item.url),
    );
    const packages = Array.isArray(server.packages) ? server.packages : [];
    if (out.some((existing) => existing.name === name)) continue;
    out.push({
      name,
      title: str(server.title),
      description: (str(server.description) ?? "").slice(0, 300),
      remoteUrl: remote ? String(remote.url) : null,
      localOnly: !remote && packages.length > 0,
      repository: str((server.repository as { url?: unknown })?.url),
    });
  }
  return out;
}

export async function searchRegistry(query: string, limit = 12) {
  const key = `${query.toLowerCase()}|${limit}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.servers;
  const response = await fetch(
    `${BASE}?limit=${limit}&search=${encodeURIComponent(query)}`,
    { signal: AbortSignal.timeout(8_000), cache: "no-store" },
  );
  if (!response.ok) throw new Error(`registry_unavailable:${response.status}`);
  const servers = parseRegistry(await response.json());
  cache.set(key, { at: Date.now(), servers });
  return servers;
}
