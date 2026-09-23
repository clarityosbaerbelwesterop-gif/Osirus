import { safeFetch } from "./fetch";
import type { ProviderStatus, ResearchToolProvider, SearchHit } from "./types";

// Where research can look.
//
// Keyless providers work everywhere the deployment has egress. Keyed ones are
// listed whether or not they are configured, so the agent -- and the user --
// can see exactly which sources are unavailable and why, rather than getting
// silently thinner research.

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const page = await safeFetch(url, { signal, accept: "application/json" });
  if (page.status >= 400) throw new Error(`http_${page.status}`);
  return JSON.parse(page.body) as T;
}

export class WikipediaProvider implements ResearchToolProvider {
  readonly id = "wikipedia";
  readonly kind = "both" as const;
  constructor(private readonly language = "en") {}
  status(): ProviderStatus {
    return { configured: true, reason: "Keyless MediaWiki API." };
  }
  async search(
    query: string,
    { limit, signal }: { limit: number; signal?: AbortSignal },
  ): Promise<SearchHit[]> {
    const url = `https://${this.language}.wikipedia.org/w/api.php?action=query&list=search&format=json&utf8=1&srlimit=${limit}&srsearch=${encodeURIComponent(query)}`;
    const data = await getJson<{
      query?: {
        search?: Array<{ title: string; snippet: string; timestamp?: string }>;
      };
    }>(url, signal);
    return (data.query?.search ?? []).map((hit) => ({
      url: `https://${this.language}.wikipedia.org/wiki/${encodeURIComponent(hit.title.replaceAll(" ", "_"))}`,
      title: hit.title,
      snippet: hit.snippet.replace(/<[^>]+>/g, ""),
      provider: this.id,
      publishedAt: hit.timestamp ?? null,
    }));
  }
}

/** Plain-text extract of a Wikipedia article, cleaner than its HTML. */
export async function wikipediaExtract(url: string, signal?: AbortSignal) {
  const match = new URL(url).pathname.match(/^\/wiki\/(.+)$/);
  const host = new URL(url).hostname;
  if (!match) return null;
  const title = decodeURIComponent(match[1]!);
  const api = `https://${host}/w/api.php?action=query&prop=extracts|revisions&rvprop=timestamp&explaintext=1&redirects=1&format=json&titles=${encodeURIComponent(title)}`;
  const data = await getJson<{
    query?: {
      pages?: Record<
        string,
        {
          title?: string;
          extract?: string;
          revisions?: Array<{ timestamp?: string }>;
        }
      >;
    };
  }>(api, signal);
  const page = Object.values(data.query?.pages ?? {})[0];
  if (!page?.extract) return null;
  return {
    title: page.title ?? title,
    text: page.extract,
    publishedAt: page.revisions?.[0]?.timestamp ?? null,
  };
}

export class GitHubProvider implements ResearchToolProvider {
  readonly id = "github";
  readonly kind = "search" as const;
  status(): ProviderStatus {
    return {
      configured: true,
      reason: "Keyless GitHub search (rate-limited).",
    };
  }
  async search(
    query: string,
    { limit, signal }: { limit: number; signal?: AbortSignal },
  ): Promise<SearchHit[]> {
    const data = await getJson<{
      items?: Array<{
        html_url: string;
        full_name: string;
        description: string | null;
        pushed_at?: string;
      }>;
    }>(
      `https://api.github.com/search/repositories?per_page=${limit}&q=${encodeURIComponent(query)}`,
      signal,
    );
    return (data.items ?? []).map((item) => ({
      url: item.html_url,
      title: item.full_name,
      snippet: item.description ?? "",
      provider: this.id,
      publishedAt: item.pushed_at ?? null,
    }));
  }
}

export class McpRegistryProvider implements ResearchToolProvider {
  readonly id = "mcp_registry";
  readonly kind = "search" as const;
  status(): ProviderStatus {
    return {
      configured: true,
      reason: "Official MCP Registry (registry.modelcontextprotocol.io).",
    };
  }
  async search(
    query: string,
    { limit, signal }: { limit: number; signal?: AbortSignal },
  ): Promise<SearchHit[]> {
    const data = await getJson<{
      servers?: Array<{
        server?: {
          name?: string;
          description?: string;
          repository?: { url?: string };
          websiteUrl?: string;
        };
      }>;
    }>(
      `https://registry.modelcontextprotocol.io/v0/servers?limit=${limit}&search=${encodeURIComponent(query)}`,
      signal,
    );
    return (data.servers ?? [])
      .map((entry) => entry.server ?? {})
      .filter((server) => server.name)
      .map((server) => ({
        url:
          server.repository?.url ??
          server.websiteUrl ??
          `https://registry.modelcontextprotocol.io/v0/servers?search=${encodeURIComponent(server.name!)}`,
        title: server.name!,
        snippet: server.description ?? "",
        provider: this.id,
      }));
  }
}

type KeyedSpec = {
  id: string;
  env: string;
  endpoint: string;
  body: (query: string, limit: number) => Record<string, unknown>;
  headers: (key: string) => Record<string, string>;
  parse: (data: unknown) => SearchHit[];
};

/**
 * A search API that needs an account. Without its key it reports
 * NOT_CONFIGURED and is never called -- no fallback pretends to be it.
 */
export class KeyedSearchProvider implements ResearchToolProvider {
  readonly kind = "search" as const;
  constructor(private readonly spec: KeyedSpec) {}
  get id() {
    return this.spec.id;
  }
  private key() {
    const value = process.env[this.spec.env];
    return value && value.trim() ? value.trim() : null;
  }
  status(): ProviderStatus {
    return this.key()
      ? { configured: true, reason: `${this.spec.env} is set.` }
      : {
          configured: false,
          reason: `NOT_CONFIGURED: ${this.spec.env} is not set.`,
        };
  }
  async search(
    query: string,
    { limit, signal }: { limit: number; signal?: AbortSignal },
  ): Promise<SearchHit[]> {
    const key = this.key();
    if (!key) throw new Error(`${this.id}_not_configured`);
    const response = await fetch(this.spec.endpoint, {
      method: "POST",
      signal,
      headers: {
        "content-type": "application/json",
        ...this.spec.headers(key),
      },
      body: JSON.stringify(this.spec.body(query, limit)),
    });
    if (!response.ok) throw new Error(`${this.id}_http_${response.status}`);
    return this.spec.parse(await response.json()).slice(0, limit);
  }
}

const asHits = (
  provider: string,
  items: unknown,
  pick: (item: Record<string, unknown>) => SearchHit | null,
) =>
  (Array.isArray(items) ? items : [])
    .map((item) => pick({ ...(item as Record<string, unknown>) }))
    .filter((hit): hit is SearchHit => Boolean(hit))
    .map((hit) => ({ ...hit, provider }));

export const tavily = new KeyedSearchProvider({
  id: "tavily",
  env: "TAVILY_API_KEY",
  endpoint: "https://api.tavily.com/search",
  headers: (key) => ({ authorization: `Bearer ${key}` }),
  body: (query, limit) => ({ query, max_results: limit }),
  parse: (data) =>
    asHits("tavily", (data as { results?: unknown }).results, (item) =>
      typeof item.url === "string"
        ? {
            url: item.url,
            title: String(item.title ?? ""),
            snippet: String(item.content ?? ""),
            provider: "tavily",
            publishedAt: (item.published_date as string) ?? null,
          }
        : null,
    ),
});

export const exa = new KeyedSearchProvider({
  id: "exa",
  env: "EXA_API_KEY",
  endpoint: "https://api.exa.ai/search",
  headers: (key) => ({ "x-api-key": key }),
  body: (query, limit) => ({ query, numResults: limit }),
  parse: (data) =>
    asHits("exa", (data as { results?: unknown }).results, (item) =>
      typeof item.url === "string"
        ? {
            url: item.url,
            title: String(item.title ?? ""),
            snippet: String(item.text ?? ""),
            provider: "exa",
            publishedAt: (item.publishedDate as string) ?? null,
          }
        : null,
    ),
});

export const firecrawl = new KeyedSearchProvider({
  id: "firecrawl",
  env: "FIRECRAWL_API_KEY",
  endpoint: "https://api.firecrawl.dev/v1/search",
  headers: (key) => ({ authorization: `Bearer ${key}` }),
  body: (query, limit) => ({ query, limit }),
  parse: (data) =>
    asHits("firecrawl", (data as { data?: unknown }).data, (item) =>
      typeof item.url === "string"
        ? {
            url: item.url,
            title: String(item.title ?? ""),
            snippet: String(item.description ?? ""),
            provider: "firecrawl",
          }
        : null,
    ),
});

/** Research sources reachable only as MCP servers. Listed, not faked. */
export const MCP_RESEARCH_SOURCES = [
  {
    id: "context7",
    repo: "https://github.com/upstash/context7",
    env: "CONTEXT7_MCP_URL",
  },
  {
    id: "apify",
    repo: "https://github.com/apify/actors-mcp-server",
    env: "APIFY_TOKEN",
  },
  {
    id: "firecrawl_mcp",
    repo: "https://github.com/firecrawl/firecrawl-mcp-server",
    env: "FIRECRAWL_API_KEY",
  },
  {
    id: "exa_mcp",
    repo: "https://github.com/exa-labs/exa-mcp-server",
    env: "EXA_API_KEY",
  },
  {
    id: "tavily_mcp",
    repo: "https://github.com/tavily-ai/tavily-mcp",
    env: "TAVILY_API_KEY",
  },
];

export function defaultSearchProviders(): ResearchToolProvider[] {
  return [
    new WikipediaProvider(),
    new GitHubProvider(),
    new McpRegistryProvider(),
    tavily,
    exa,
    firecrawl,
  ];
}

export function sourceCatalog(providers = defaultSearchProviders()) {
  return [
    ...providers.map((provider) => ({
      id: provider.id,
      kind: "api",
      ...provider.status(),
    })),
    ...MCP_RESEARCH_SOURCES.map((source) => ({
      id: source.id,
      kind: "mcp",
      configured: Boolean(process.env[source.env]?.trim()),
      reason: process.env[source.env]?.trim()
        ? `${source.env} is set; connect through the MCP registry client.`
        : `NOT_CONFIGURED: ${source.env} is not set (${source.repo}).`,
    })),
  ];
}
