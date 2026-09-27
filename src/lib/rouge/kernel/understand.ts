import { isSmallTalk } from "../../runtime/small-talk";

// Task understanding (M57): what the person asked for, before any model call.
//
// Deterministic and cheap on purpose. The kernel needs two facts it can act
// on without spending a call: whether the message is small talk (answer
// fast, no deliberation), and whether the person fixed the shape of the
// answer ("reply with the number only", "nur JSON"). A fixed shape is a
// contract the answer is checked against; everything else is free-form.
//
// The patterns are written for phrasings in general -- English and German
// -- not for any evaluation task. The kernel evaluation runs a holdout set
// with phrasings these patterns never saw.

export type AnswerContract =
  | { kind: "free" }
  | { kind: "number" }
  | { kind: "fraction" }
  | { kind: "word"; options: string[] | null }
  | { kind: "words"; count: number }
  | { kind: "json" };

export type Understanding = {
  smallTalk: boolean;
  language: "de" | "en" | "other";
  contract: AnswerContract;
};

const NUMBER_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  ein: 1,
  eins: 1,
  einem: 1,
  zwei: 2,
  drei: 3,
  vier: 4,
  fünf: 5,
  sechs: 6,
  sieben: 7,
  acht: 8,
  neun: 9,
  zehn: 10,
};

/** "only", "nothing else", "nur", "sonst nichts" -- a restriction is being set. */
const RESTRICTS =
  /\b(only|just|nothing else|no other text|no explanation|alone|one word|single word|nur|ausschließlich|ausschliesslich|sonst nichts|ohne erklärung|ohne weitere|ein(?:em)? (?:einzigen )?wort)\b/i;

function detectLanguage(text: string): Understanding["language"] {
  const lower = ` ${text.toLowerCase()} `;
  const de =
    (
      lower.match(
        / (der|die|das|und|ist|nicht|mit|wie|was|welche[rs]?|antworte|bitte|ich|du|ein|eine|nur|für|auf|heute)\b/g,
      ) ?? []
    ).length + (/[äöüß]/.test(lower) ? 2 : 0);
  const en = (
    lower.match(
      / (the|and|is|not|with|how|what|which|reply|please|i|you|a|an|only|for|on|today)\b/g,
    ) ?? []
  ).length;
  if (de === 0 && en === 0) return "other";
  return de > en ? "de" : "en";
}

function wordCount(text: string): number | null {
  const match = text.match(
    /\b(?:exactly|genau)\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten|ein|eins|einem|zwei|drei|vier|fünf|sechs|sieben|acht|neun|zehn)\s+(?:words?|wörter(?:n)?|wort)\b/i,
  );
  if (!match) return null;
  const raw = match[1]!.toLowerCase();
  const value = /^\d+$/.test(raw) ? Number(raw) : NUMBER_WORDS[raw];
  return value && value > 0 && value <= 50 ? value : null;
}

function wordOptions(text: string): string[] | null {
  // "Reply with one word: Apples, Oranges or Mixed" / "true or false"
  const listed = text.match(
    /(?:one word|ein(?:em)? wort|one of)\s*[:\-–]\s*([^.?!\n]+)/i,
  );
  const source =
    listed?.[1] ??
    text.match(
      /\b(true or false|wahr oder falsch|yes or no|ja oder nein)\b/i,
    )?.[1];
  if (!source) return null;
  const options = source
    .split(/,|\bor\b|\boder\b|\//i)
    .map((option) => option.trim().replace(/[.!?"'`]/g, ""))
    .filter((option) => /^[\p{L}\p{N}-]{1,40}$/u.test(option));
  return options.length >= 2 ? options : null;
}

export function contractOf(text: string): AnswerContract {
  // Only the last paragraph sets the reply's shape: an earlier line may
  // quote an instruction that belongs to something else.
  const last =
    text
      .trim()
      .split(/\n\s*\n/)
      .at(-1) ?? text;

  const words = wordCount(last);
  if (words !== null) return { kind: "words", count: words };

  if (!RESTRICTS.test(last)) return { kind: "free" };

  if (
    /\b(json)\b/i.test(last) &&
    /\b(only|nur|nothing else|sonst nichts|just)\b/i.test(last)
  )
    return { kind: "json" };
  if (/\b(fraction|bruch)\b/i.test(last)) return { kind: "fraction" };
  if (
    /\b(the |a |with the |mit der |nur die |nur mit der )?(number|numeral|integer|zahl|ziffer|ganzzahl|result as a number|numeric answer)\b/i.test(
      last,
    )
  )
    return { kind: "number" };
  if (
    /\b(one word|single word|ein(?:em)? (?:einzigen )?wort|the (?:name|symbol|weekday|day|word|letter|color|colour|city|country)|(?:dem|den|der|das) (?:namen|symbol|wochentag|tag|wort|buchstaben)|true or false|wahr oder falsch|yes or no|ja oder nein)\b/i.test(
      last,
    )
  )
    return { kind: "word", options: wordOptions(last) };
  return { kind: "free" };
}

export function understand(latestUserMessage: string): Understanding {
  return {
    smallTalk: isSmallTalk(latestUserMessage),
    language: detectLanguage(latestUserMessage),
    contract: contractOf(latestUserMessage),
  };
}
