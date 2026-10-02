/**
 * Completion integrity for AI-mode program answers.
 * A requested HTML page is shown only when it is a closed document with the
 * asked heading. A withheld completion is reported as withheld. This is not a
 * benchmark score and it does not relax the security gate.
 */

export type CompletionKind = "page" | "withheld" | "incomplete" | "text";

export function asksForHtmlPage(text: string): boolean {
  return /\bhtml\b/i.test(text) && /\bpage\b/i.test(text);
}

/** A heading the user named in quotes after h1. Otherwise any h1 text counts. */
export function askedHeading(text: string): string | null {
  const quoted = text.match(/\bh1\b[^.\n]{0,120}?["“']([^"”']+)["”']/i);
  const named = quoted?.[1]?.trim() ?? "";
  return named.length > 0 ? named : null;
}

function documentSlice(completion: string): string {
  const fenced = completion.match(/```html\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return fenced[1];
  const start = completion.search(/<!DOCTYPE|<html[\s>]/i);
  if (start < 0) return completion;
  return completion.slice(start);
}

export function pageWellFormed(
  request: string,
  completion: string,
): { ok: boolean; reason: string } {
  const doc = documentSlice(completion);
  const open = doc.search(/<html[\s>]/i);
  const close = doc.search(/<\/html>/i);
  if (open < 0 || close < open) {
    return { ok: false, reason: "document is not closed" };
  }
  const inner = doc.slice(open, close + "</html>".length);
  if (/<style\b/i.test(inner) && !/<\/style>/i.test(inner)) {
    return { ok: false, reason: "style element is not closed" };
  }
  if (/<body\b/i.test(inner) && !/<\/body>/i.test(inner)) {
    return { ok: false, reason: "body is not closed" };
  }
  const h1 = inner.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
  const heading = h1?.[1]?.replace(/<[^>]+>/g, "").trim() ?? "";
  if (!heading) return { ok: false, reason: "asked heading is missing" };
  const wanted = askedHeading(request);
  if (wanted && !heading.toLowerCase().includes(wanted.toLowerCase())) {
    return { ok: false, reason: "asked heading is missing" };
  }
  return { ok: true, reason: "closed document with heading" };
}

export function presentCompletion(input: {
  request: string;
  modelText: string;
  withheld: boolean;
  withheldText: string;
}): { kind: CompletionKind; text: string } {
  if (input.withheld) {
    return {
      kind: "withheld",
      text: `Completion: withheld. ${input.withheldText} It is not shown as the model's page.`,
    };
  }
  if (!asksForHtmlPage(input.request)) {
    return { kind: "text", text: input.modelText };
  }
  const page = pageWellFormed(input.request, input.modelText);
  if (!page.ok) {
    return {
      kind: "incomplete",
      text: `Completion: incomplete. ${page.reason}. The fallback is not shown as the model's page.`,
    };
  }
  return { kind: "page", text: input.modelText };
}
