/**
 * Greetings, thanks, acknowledgements and small talk, in German and English.
 *
 * These need an answer, not a plan. Without this they score below every
 * arm's threshold, look "ambiguous", and go to the model classifier -- which
 * once answered "Hallo" with general + coding + research: 25 stages, two
 * identical answers and 103 s of source gathering. The list is closed on
 * purpose: a short objective is not small talk just because it is short
 * ("Baue mir eine Todo App" is a task the English-only heuristics also
 * score at zero).
 */
const SMALL_TALK_PHRASES = [
  "guten morgen",
  "guten tag",
  "guten abend",
  "gute nacht",
  "good morning",
  "good afternoon",
  "good evening",
  "grüß gott",
  "grüss gott",
  "vielen dank",
  "danke schön",
  "danke sehr",
  "thank you",
  "thanks a lot",
  "alles klar",
  "wie geht es dir",
  "wie geht es",
  "wie gehts",
  "wie geht s",
  "how are you",
  "how is it going",
  "what s up",
  "whats up",
  "was geht",
  "wer bist du",
  "who are you",
  "was kannst du",
  "what can you do",
  "bis später",
  "bis bald",
  "see you",
  "hallo",
  "hallöchen",
  "hello",
  "hi",
  "hey",
  "heyho",
  "huhu",
  "moin",
  "servus",
  "grüezi",
  "howdy",
  "yo",
  "na",
  "danke",
  "dankeschön",
  "thanks",
  "thx",
  "merci",
  "ok",
  "okay",
  "cool",
  "super",
  "perfekt",
  "top",
  "great",
  "nice",
  "tschüss",
  "tschüs",
  "bye",
  "ciao",
  // Fillers that only ever ride along with one of the phrases above.
  "osirus",
  "du",
  "dir",
  "there",
  "zusammen",
  "leute",
  "mal",
  "nochmal",
  "und",
  "and",
  "so",
  "also",
  "ja",
  "yes",
];

const SMALL_TALK_FILLERS = new Set([
  "osirus",
  "du",
  "dir",
  "there",
  "zusammen",
  "leute",
  "mal",
  "nochmal",
  "und",
  "and",
  "so",
  "also",
  "ja",
  "yes",
]);

/** True when the whole objective is greeting, thanks or small talk. */
export function isSmallTalk(objective: string) {
  if (objective.length > 80) return false;
  let rest = objective
    .toLowerCase()
    .replace(/[^\p{L}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!rest) return false;
  let meaningful = 0;
  while (rest) {
    const phrase = SMALL_TALK_PHRASES.find(
      (candidate) => rest === candidate || rest.startsWith(`${candidate} `),
    );
    if (!phrase) return false;
    if (!SMALL_TALK_FILLERS.has(phrase)) meaningful += 1;
    rest = rest.slice(phrase.length).trim();
  }
  return meaningful > 0;
}
