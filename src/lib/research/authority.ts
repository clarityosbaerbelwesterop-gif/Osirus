import type { Authority } from "./types";

// Not every URL is equal. A statistic from a national statistics office and
// the same number on a content farm are different evidence, and the claim
// graph needs to know which it has.

const NEWS = [
  "reuters.com",
  "apnews.com",
  "bbc.co.uk",
  "bbc.com",
  "nytimes.com",
  "ft.com",
  "economist.com",
  "theguardian.com",
  "wsj.com",
  "bloomberg.com",
  "tagesschau.de",
  "spiegel.de",
  "zeit.de",
  "faz.net",
];
const COMMUNITY = [
  "stackoverflow.com",
  "reddit.com",
  "medium.com",
  "dev.to",
  "quora.com",
  "news.ycombinator.com",
  "substack.com",
  "hashnode.dev",
];
const PRIMARY_SUFFIXES = [
  ".gov",
  ".gov.uk",
  ".gv.at",
  ".admin.ch",
  ".bund.de",
  "europa.eu",
  ".mil",
  "ietf.org",
  "w3.org",
  "iso.org",
  "rfc-editor.org",
  "arxiv.org",
  "doi.org",
  "nature.com",
  "science.org",
  "acm.org",
  "ieee.org",
  "nih.gov",
  "who.int",
  "un.org",
  "oecd.org",
  "destatis.de",
  "eurostat.ec.europa.eu",
];

function matches(host: string, domain: string) {
  return (
    host === domain ||
    host.endsWith(`.${domain}`) ||
    (domain.startsWith(".") && host.endsWith(domain))
  );
}

export function classifyAuthority(rawUrl: string): Authority {
  let host: string;
  try {
    host = new URL(rawUrl).hostname.toLowerCase();
  } catch {
    return "secondary";
  }
  if (PRIMARY_SUFFIXES.some((domain) => matches(host, domain)))
    return "primary";
  if (
    /^(docs|developer|developers|learn|api|reference)\./.test(host) ||
    host === "github.com" ||
    host === "raw.githubusercontent.com"
  ) {
    return "official_docs";
  }
  if (host.endsWith("wikipedia.org")) return "reference";
  if (NEWS.some((domain) => matches(host, domain))) return "news";
  if (COMMUNITY.some((domain) => matches(host, domain))) return "community";
  return "secondary";
}

export const AUTHORITY_WEIGHT: Record<Authority, number> = {
  primary: 1,
  official_docs: 0.9,
  reference: 0.7,
  news: 0.6,
  secondary: 0.45,
  community: 0.3,
};

export function publisherOf(rawUrl: string, declared: string | null) {
  if (declared) return declared;
  try {
    return new URL(rawUrl).hostname.replace(/^www\./, "");
  } catch {
    return "unknown";
  }
}
