// Core selection tasks (M56.1).
//
// Written by the teacher (the Claude development session) to choose which
// foundation core Rouge runs on when Grok 4.6 cannot answer. Every task has
// one right answer that code can check -- no model grades another. The set
// spans unrelated families on purpose: arithmetic, time and dates, units,
// logic, code reading, probability, German, instruction following and
// facts, so a core that is only good at one of them does not win.
//
// These are evaluation tasks. They must never enter a Rouge training or
// evolution dataset (docs/rouge/architecture.md, principle 5).

export type CoreTask = {
  id: string;
  family:
    | "arithmetic"
    | "time"
    | "units"
    | "logic"
    | "code"
    | "probability"
    | "german"
    | "instruction"
    | "facts";
  prompt: string;
  /** True when the answer is right, however it is wrapped. */
  correct: (text: string) => boolean;
  /** True when the reply is exactly the answer, as instructed. */
  strict: (text: string) => boolean;
};

const bare = (text: string) =>
  text
    .trim()
    .replace(/^```[a-z]*\s*|\s*```$/gi, "")
    .replace(/^["'`*_]+|["'`*_.!]+$/g, "")
    .trim();

/** The number appears as a whole number token (so 12 does not match -12). */
function number(answer: string): Pick<CoreTask, "correct" | "strict"> {
  const escaped = answer.replace(/[-.]/g, (c) => `\\${c}`);
  const pattern = new RegExp(`(^|[^\\d.\\-])${escaped}(?![\\d])`);
  return {
    correct: (text) =>
      pattern.test(` ${text.replace(/(\d),(\d{3})/g, "$1$2")}`),
    strict: (text) => bare(text).replace(/(\d),(\d{3})/g, "$1$2") === answer,
  };
}

function word(answer: string): Pick<CoreTask, "correct" | "strict"> {
  const pattern = new RegExp(`\\b${answer}\\b`, "i");
  return {
    correct: (text) => pattern.test(text),
    strict: (text) => bare(text).toLowerCase() === answer.toLowerCase(),
  };
}

export const CORE_TASKS: CoreTask[] = [
  {
    id: "arith-1",
    family: "arithmetic",
    prompt: "What is 48 * 37 - 125? Reply with the number only.",
    ...number("1651"),
  },
  {
    id: "arith-2",
    family: "arithmetic",
    prompt: "Compute (2^10 + 3^5) mod 97. Reply with the number only.",
    ...number("6"),
  },
  {
    id: "algebra",
    family: "arithmetic",
    prompt: "Solve for x: 3x + 7 = 2x - 5. Reply with the number only.",
    ...number("-12"),
  },
  {
    id: "time-1",
    family: "time",
    prompt:
      "A train leaves at 09:40 and arrives at 13:05 on the same day. How many minutes does the journey take? Reply with the number only.",
    ...number("205"),
  },
  {
    id: "date-1",
    family: "time",
    prompt:
      "What day of the week was 1 January 2000? Reply with the English weekday only.",
    ...word("Saturday"),
  },
  {
    id: "units-1",
    family: "units",
    prompt:
      "How many millilitres are in 2.75 litres? Reply with the number only.",
    ...number("2750"),
  },
  {
    id: "units-2",
    family: "units",
    prompt:
      "A car drives at 90 km/h for 2 hours 20 minutes. How many kilometres does it cover? Reply with the number only.",
    ...number("210"),
  },
  {
    id: "logic-1",
    family: "logic",
    prompt:
      "Alice is older than Bob. Bob is older than Carol. Dana is younger than Carol. Who is the youngest? Reply with the name only.",
    ...word("Dana"),
  },
  {
    id: "logic-2",
    family: "logic",
    prompt:
      "Three boxes are labelled Apples, Oranges and Mixed, and every label is wrong. You take one fruit from the box labelled Mixed and it is an apple. What does the box labelled Oranges contain? Reply with one word: Apples, Oranges or Mixed.",
    ...word("Mixed"),
  },
  {
    id: "logic-3",
    family: "logic",
    prompt:
      "If it takes 5 machines 5 minutes to make 5 widgets, how many minutes does it take 100 machines to make 100 widgets? Reply with the number only.",
    ...number("5"),
  },
  {
    id: "code-1",
    family: "code",
    prompt:
      "What does this JavaScript print? const a = [3, 1, 2]; a.sort(); console.log(a.map((x) => x * 2).join('-')); Reply with the printed output only.",
    correct: (text) => /(^|[^\d-])2-4-6(?![\d-])/.test(` ${text}`),
    strict: (text) => bare(text) === "2-4-6",
  },
  {
    id: "code-2",
    family: "code",
    prompt:
      "In Python, what is len(set('mississippi'))? Reply with the number only.",
    ...number("4"),
  },
  {
    id: "code-3",
    family: "code",
    prompt:
      "In JavaScript, what does 0.1 + 0.2 === 0.3 evaluate to? Reply with true or false only.",
    ...word("false"),
  },
  {
    id: "prob-1",
    family: "probability",
    prompt:
      "A fair six-sided die is rolled twice. What is the probability that the two rolls sum to 7? Reply with a fraction in lowest terms only.",
    correct: (text) => /(^|[^\d])1\s*\/\s*6(?![\d])/.test(` ${text}`),
    strict: (text) => bare(text).replace(/\s/g, "") === "1/6",
  },
  {
    id: "seq-1",
    family: "arithmetic",
    prompt:
      "What number comes next: 2, 6, 12, 20, 30, ? Reply with the number only.",
    ...number("42"),
  },
  {
    id: "de-1",
    family: "german",
    prompt: "Wie viele Minuten hat ein Tag? Antworte nur mit der Zahl.",
    ...number("1440"),
  },
  {
    id: "de-2",
    family: "german",
    prompt:
      "Heute ist Mittwoch. Welcher Wochentag ist in 10 Tagen? Antworte nur mit dem Wochentag.",
    ...word("Samstag"),
  },
  {
    id: "count-1",
    family: "logic",
    prompt:
      "How many times does the letter r appear in the word strawberry? Reply with the number only.",
    ...number("3"),
  },
  {
    id: "instr-1",
    family: "instruction",
    prompt:
      "Name three primary colours. Reply with exactly three words, all lowercase, separated by single spaces, and nothing else.",
    // An instruction task is about following the instruction: the right
    // colours in the wrong shape are not a right answer.
    correct: (text) => {
      const reply = text.trim().replace(/[.!]$/, "");
      if (!/^[a-z]+[ ,]+[a-z]+[ ,]+[a-z]+$/.test(reply)) return false;
      const words = reply.split(/[ ,]+/);
      const allowed = new Set(["red", "blue", "yellow", "green"]);
      return new Set(words).size === 3 && words.every((w) => allowed.has(w));
    },
    strict: (text) => {
      const trimmed = text.trim();
      if (!/^[a-z]+ [a-z]+ [a-z]+$/.test(trimmed)) return false;
      const words = trimmed.split(" ");
      const allowed = new Set(["red", "blue", "yellow", "green"]);
      return new Set(words).size === 3 && words.every((w) => allowed.has(w));
    },
  },
  {
    id: "instr-2",
    family: "instruction",
    prompt:
      'Return a JSON object with the keys "city" and "country" for the capital of Japan. Output only the JSON object.',
    // Only the JSON object was asked for; a code fence around it is allowed,
    // prose is not.
    correct: (text) => {
      try {
        const value = JSON.parse(bare(text)) as Record<string, unknown>;
        return (
          String(value.city).toLowerCase() === "tokyo" &&
          String(value.country).toLowerCase() === "japan"
        );
      } catch {
        return false;
      }
    },
    strict: (text) => {
      try {
        const value = JSON.parse(bare(text)) as Record<string, unknown>;
        return (
          Object.keys(value).sort().join(",") === "city,country" &&
          String(value.city) === "Tokyo" &&
          String(value.country) === "Japan"
        );
      } catch {
        return false;
      }
    },
  },
  {
    id: "facts-1",
    family: "facts",
    prompt:
      "What is the chemical symbol for tungsten? Reply with the symbol only.",
    correct: (text) => /(^|[^A-Za-z])W(?![A-Za-z])/.test(` ${text}`),
    strict: (text) => bare(text) === "W",
  },
];
