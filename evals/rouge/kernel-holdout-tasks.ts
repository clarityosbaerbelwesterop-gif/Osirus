import { bare, number, word, type CoreTask } from "./core-selection-tasks";

// Kernel holdout (M57), written by the teacher (Claude development session).
//
// Blind with respect to the kernel: these phrasings were written after the
// kernel's patterns and never used to tune them. The kernel is judged here,
// not on the development set it was built against. Evaluation only -- never
// training or evolution data.

export const KERNEL_HOLDOUT: CoreTask[] = [
  {
    id: "h-percent",
    family: "arithmetic",
    prompt: "Give me just the number: what is 15% of 240?",
    ...number("36"),
  },
  {
    id: "h-planet",
    family: "facts",
    prompt:
      "Answer with a single word. What is the largest planet in our solar system?",
    ...word("Jupiter"),
  },
  {
    id: "h-seconds",
    family: "german",
    prompt:
      "Wie viele Sekunden hat eine Stunde? Gib ausschließlich die Zahl an.",
    ...number("3600"),
  },
  {
    id: "h-prime",
    family: "logic",
    prompt: "Is 91 a prime number? Answer yes or no, nothing else.",
    ...word("no"),
  },
  {
    id: "h-power",
    family: "arithmetic",
    prompt: "Write the result of 2 to the power of 12. No explanation.",
    ...number("4096"),
  },
  {
    id: "h-author",
    family: "facts",
    prompt: "Who wrote Pride and Prejudice? Surname only.",
    ...word("Austen"),
  },
  {
    id: "h-bronze",
    family: "instruction",
    prompt: "In exactly two words, name the two metals that make bronze.",
    correct: (text) => {
      const words = bare(text)
        .toLowerCase()
        .split(/[\s,]+/)
        .filter(Boolean);
      return (
        words.length === 2 &&
        new Set(words).size === 2 &&
        words.every((w) => w === "copper" || w === "tin")
      );
    },
    strict: (text) =>
      /^(copper tin|tin copper)$/i.test(text.trim().replace(/[.!]$/, "")),
  },
  {
    id: "h-json-sum",
    family: "instruction",
    prompt: 'Return only JSON: an object with the key "sum" holding 17 + 25.',
    correct: (text) => {
      try {
        return (JSON.parse(bare(text)) as { sum?: unknown }).sum === 42;
      } catch {
        return false;
      }
    },
    strict: (text) => {
      try {
        const value = JSON.parse(text.trim()) as Record<string, unknown>;
        return Object.keys(value).join(",") === "sum" && value.sum === 42;
      } catch {
        return false;
      }
    },
  },
  {
    id: "h-month",
    family: "german",
    prompt: "Welcher Monat hat 28 oder 29 Tage? Antworte mit einem Wort.",
    ...word("Februar"),
  },
  {
    id: "h-pens",
    family: "arithmetic",
    prompt:
      "A shop sells pens at 3 for 2 euros. How much do 12 pens cost in euros? Number only, please.",
    ...number("8"),
  },
  {
    id: "h-sort",
    family: "instruction",
    prompt:
      "Sort these numbers from smallest to largest and reply with them comma-separated, nothing else: 9, 2, 7, 4",
    correct: (text) => /^\s*2\s*,\s*4\s*,\s*7\s*,\s*9\s*\.?\s*$/.test(text),
    strict: (text) => /^2, ?4, ?7, ?9$/.test(text.trim()),
  },
  {
    id: "h-coins",
    family: "probability",
    prompt:
      "What is the probability of getting two heads when flipping two fair coins? Give the answer as a fraction and nothing else.",
    correct: (text) => /(^|[^\d])1\s*\/\s*4(?![\d])/.test(` ${text}`),
    strict: (text) => bare(text).replace(/\s/g, "") === "1/4",
  },
  {
    id: "h-vowels",
    family: "logic",
    prompt:
      "How many vowels (a, e, i, o, u) are in the word education? Just the number.",
    ...number("5"),
  },
  {
    id: "h-fahrenheit",
    family: "units",
    prompt:
      "Convert 100 degrees Fahrenheit to Celsius, rounded to the nearest whole number. Reply with the integer only.",
    ...number("38"),
  },
  {
    id: "h-days-ago",
    family: "time",
    prompt: "If today is Friday, what day was it 3 days ago? One word.",
    ...word("Tuesday"),
  },
  {
    id: "h-floor-div",
    family: "code",
    prompt: "What does Python's print(7 // 2) output? Output only.",
    ...number("3"),
  },
  {
    id: "h-letters",
    family: "german",
    prompt: "Wie viele Buchstaben hat das Wort Rhabarber? Nur die Zahl.",
    ...number("9"),
  },
  {
    id: "h-larger",
    family: "arithmetic",
    prompt: "Which is larger, 0.7 or 0.65? Reply with the number only.",
    correct: (text) =>
      /(^|[^\d.])0\.7(?![\d])/.test(` ${text}`) &&
      !/0\.65\s*(is|ist)\s*(larger|größer)/i.test(text),
    strict: (text) => bare(text) === "0.7",
  },
  {
    id: "h-translate",
    family: "german",
    prompt: "Translate 'thank you' into German. Only the translation.",
    correct: (text) => /\bdanke\b/i.test(text),
    strict: (text) =>
      /^(danke|danke schön|danke sehr|vielen dank)$/i.test(bare(text)),
  },
  {
    id: "h-capital",
    family: "facts",
    prompt: "What is the capital of Australia? One word only.",
    ...word("Canberra"),
  },
];
