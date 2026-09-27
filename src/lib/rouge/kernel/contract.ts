import type { AnswerContract } from "./understand";

// Answer contracts (M57): does a reply have the shape the person asked for?
//
// A pure check, run on every draft that has a contract. It never rewrites
// the answer -- guessing which number in a paragraph was meant is how a
// right answer becomes a wrong one. A draft that breaks its contract gets
// one repair round from the core, with the reason stated.

export type ContractVerdict = { ok: true } | { ok: false; reason: string };

/** Strip what never counts as content: whitespace, one trailing full stop. */
function core(text: string) {
  return text.trim().replace(/[.!]$/, "").trim();
}

const FENCED = /^```/;

export function checkContract(
  contract: AnswerContract,
  text: string,
): ContractVerdict {
  const reply = core(text);
  if (!reply) return { ok: false, reason: "the reply is empty" };
  switch (contract.kind) {
    case "free":
      return { ok: true };
    case "number":
      return /^-?\d{1,3}(?:[,\s]\d{3})*(?:\.\d+)?$|^-?\d+(?:[.,]\d+)?$/.test(
        reply,
      )
        ? { ok: true }
        : { ok: false, reason: "the reply must be only the number" };
    case "fraction":
      return /^-?\d+\s*\/\s*\d+$/.test(reply)
        ? { ok: true }
        : {
            ok: false,
            reason: "the reply must be only the fraction, like 3/4",
          };
    case "word": {
      if (!/^[\p{L}\p{N}][\p{L}\p{N}+#'-]{0,59}$/u.test(reply))
        return { ok: false, reason: "the reply must be a single word" };
      if (
        contract.options &&
        !contract.options.some(
          (option) => option.toLowerCase() === reply.toLowerCase(),
        )
      )
        return {
          ok: false,
          reason: `the reply must be one of: ${contract.options.join(", ")}`,
        };
      return { ok: true };
    }
    case "words": {
      const words = reply.split(/\s+/).filter(Boolean);
      return words.length === contract.count &&
        words.every((word) => /^[\p{L}\p{N}'-]+,?$/u.test(word))
        ? { ok: true }
        : {
            ok: false,
            reason: `the reply must be exactly ${contract.count} words and nothing else`,
          };
    }
    case "json": {
      if (FENCED.test(text.trim()))
        return {
          ok: false,
          reason: "the reply must be the raw JSON, without a code fence",
        };
      try {
        const value: unknown = JSON.parse(text.trim());
        return value !== null && typeof value === "object"
          ? { ok: true }
          : { ok: false, reason: "the reply must be a JSON object or array" };
      } catch {
        return {
          ok: false,
          reason: "the reply must be valid JSON and nothing else",
        };
      }
    }
  }
}

/** What the contract asks for, in words the core is told up front. */
export function describeContract(contract: AnswerContract): string | null {
  switch (contract.kind) {
    case "free":
      return null;
    case "number":
      return "Reply with the number only: no words, no units, no explanation.";
    case "fraction":
      return "Reply with the fraction only (for example 3/4): no words, no explanation.";
    case "word":
      return contract.options
        ? `Reply with exactly one of these words and nothing else: ${contract.options.join(", ")}.`
        : "Reply with a single word only: no sentence, no explanation.";
    case "words":
      return `Reply with exactly ${contract.count} words and nothing else.`;
    case "json":
      return "Reply with the raw JSON only: no code fence, no explanation.";
  }
}
