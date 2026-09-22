import { randomUUID } from "node:crypto";
import type { EvidenceStore, ResearchDocument, VerifiedClaim } from "./types";

const MAX_TEXT = 400_000;

/** For tests and the live-eval harness, which run without a database. */
export class MemoryEvidenceStore implements EvidenceStore {
  private readonly docs: ResearchDocument[] = [];
  readonly claims: VerifiedClaim[] = [];

  async addDocument(document: Omit<ResearchDocument, "id">) {
    const existing = this.docs.find(
      (doc) =>
        doc.url === document.url && doc.contentHash === document.contentHash,
    );
    if (existing) return existing;
    const stored = {
      ...document,
      id: randomUUID(),
      text: document.text.slice(0, MAX_TEXT),
    };
    this.docs.push(stored);
    return stored;
  }
  async documents() {
    return [...this.docs];
  }
  async findByUrl(url: string) {
    return this.docs.find((doc) => doc.url === url) ?? null;
  }
  async saveClaims(claims: VerifiedClaim[]) {
    this.claims.push(...claims);
  }
}
