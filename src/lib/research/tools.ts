import { z } from "zod";
import type { ToolDefinition } from "../tools/registry";
import { classifyAuthority, publisherOf } from "./authority";
import { contentHash, htmlToText, safeFetch } from "./fetch";
import {
  defaultSearchProviders,
  sourceCatalog,
  wikipediaExtract,
} from "./providers";
import type { EvidenceStore, ResearchToolProvider } from "./types";

// Research as tools.
//
// research.fetch is the only way a document enters the evidence store, and
// the evidence store is the only thing the citation verifier accepts. So a
// source the agent never fetched cannot be cited, however confidently the
// model names it.

const MODEL_VIEW = 6000;

export function researchTools(
  store: EvidenceStore,
  providers: ResearchToolProvider[] = defaultSearchProviders(),
): ToolDefinition[] {
  const configured = providers.filter(
    (provider) => provider.search && provider.status().configured,
  );

  const search: ToolDefinition<
    { query: string; provider?: string; limit?: number },
    unknown
  > = {
    id: "research.search",
    title: "Search",
    summary: `Search for sources. Configured providers: ${configured.map((p) => p.id).join(", ") || "none"}. Returns URLs to fetch; a search hit is not evidence until fetched.`,
    trust: "builtin",
    effect: "read",
    risk: "low",
    arms: [
      "research",
      "general",
      "thinking",
      "coding",
      "building",
      "math_science",
    ],
    inputSchema: z.object({
      query: z.string().min(2).max(300),
      provider: z.string().max(40).optional(),
      limit: z.number().int().min(1).max(10).optional(),
    }),
    run: async ({ query, provider, limit }, context) => {
      const targets = provider
        ? configured.filter((p) => p.id === provider)
        : configured;
      if (targets.length === 0) {
        return {
          hits: [],
          note: provider
            ? `${provider} is not configured.`
            : "No search provider is configured.",
        };
      }
      const settled = await Promise.allSettled(
        targets.map((p) =>
          p.search!(query, { limit: limit ?? 5, signal: context.signal }),
        ),
      );
      const hits = settled.flatMap((outcome) =>
        outcome.status === "fulfilled" ? outcome.value : [],
      );
      const failures = settled
        .map((outcome, index) =>
          outcome.status === "rejected"
            ? `${targets[index]!.id}: ${String(outcome.reason).slice(0, 120)}`
            : null,
        )
        .filter(Boolean);
      return { hits: hits.slice(0, 15), failures };
    },
  };

  const fetchTool: ToolDefinition<{ url: string }, unknown> = {
    id: "research.fetch",
    title: "Fetch a source",
    summary:
      "Fetch a URL, extract its text and store it as evidence. Only fetched documents may be cited.",
    trust: "builtin",
    effect: "read",
    risk: "low",
    arms: [
      "research",
      "general",
      "thinking",
      "coding",
      "building",
      "math_science",
    ],
    inputSchema: z.object({ url: z.string().url().max(2000) }),
    run: async ({ url }, context) => {
      let title = "";
      let text = "";
      let publisher: string | null = null;
      let publishedAt: string | null = null;
      let finalUrl = url;
      let provider = "web";
      const host = new URL(url).hostname;
      if (
        host.endsWith("wikipedia.org") &&
        new URL(url).pathname.startsWith("/wiki/")
      ) {
        const extract = await wikipediaExtract(url, context.signal);
        if (extract) {
          ({ title, text, publishedAt } = extract);
          publisher = "Wikipedia";
          provider = "wikipedia";
        }
      }
      if (!text) {
        const page = await safeFetch(url, { signal: context.signal });
        if (page.status >= 400) throw new Error(`http_${page.status}`);
        finalUrl = page.finalUrl;
        if (/html/i.test(page.contentType) || /^\s*</.test(page.body)) {
          const extracted = htmlToText(page.body);
          ({ title, text, publisher, publishedAt } = extracted);
        } else {
          text = page.body;
        }
      }
      if (text.trim().length < 40)
        throw new Error("document_has_no_readable_text");
      const document = await store.addDocument({
        url: finalUrl,
        title: title || finalUrl,
        publisher: publisherOf(finalUrl, publisher),
        publishedAt,
        retrievedAt: new Date().toISOString(),
        contentHash: contentHash(text),
        authority: classifyAuthority(finalUrl),
        provider,
        text,
      });
      return {
        documentId: document.id,
        url: document.url,
        title: document.title,
        publisher: document.publisher,
        publishedAt: document.publishedAt,
        authority: document.authority,
        characters: document.text.length,
        // The model sees the start of the document. Excerpts it quotes are
        // checked against the full stored text, not this preview.
        text: document.text.slice(0, MODEL_VIEW),
        truncated: document.text.length > MODEL_VIEW,
      };
    },
  };

  const read: ToolDefinition<{ documentId: string; find: string }, unknown> = {
    id: "research.read",
    title: "Read within a fetched document",
    summary:
      "Return the passages of an already fetched document that mention a phrase. Use to find exact excerpts beyond the preview.",
    trust: "builtin",
    effect: "read",
    risk: "low",
    arms: [
      "research",
      "general",
      "thinking",
      "coding",
      "building",
      "math_science",
    ],
    inputSchema: z.object({
      documentId: z.string().min(1).max(64),
      find: z.string().min(2).max(120),
    }),
    run: async ({ documentId, find }) => {
      const document = (await store.documents()).find(
        (doc) => doc.id === documentId,
      );
      if (!document) throw new Error("document_not_fetched_in_this_run");
      const lower = document.text.toLowerCase();
      const needle = find.toLowerCase();
      const passages: string[] = [];
      let from = 0;
      while (passages.length < 5) {
        const at = lower.indexOf(needle, from);
        if (at < 0) break;
        passages.push(document.text.slice(Math.max(0, at - 400), at + 600));
        from = at + needle.length;
      }
      return { documentId, url: document.url, passages };
    },
  };

  const sources: ToolDefinition<Record<string, never>, unknown> = {
    id: "research.sources",
    title: "List research sources",
    summary:
      "Which research providers are configured and which are NOT_CONFIGURED, with the reason.",
    trust: "builtin",
    effect: "read",
    risk: "low",
    arms: ["research", "general", "thinking"],
    inputSchema: z.object({}).strict(),
    run: async () => ({ sources: sourceCatalog(providers) }),
  };

  return [search, fetchTool, read, sources] as ToolDefinition[];
}
