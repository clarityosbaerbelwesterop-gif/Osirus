// The M57 capability benchmark: procedurally generated, code-checked
// reasoning tasks for measuring what Rouge's cognitive kernel adds over its
// raw foundation core.
//
// Why generated. A fixed task list can leak into training data, into the
// kernel's prompts, or into the teacher's head. Here every task is produced
// from a seed at evaluation time; the blind holdout uses a fresh random seed
// nobody saw before the run, so no prompt, pattern or answer of it can have
// shaped Rouge. The generators and checkers are ordinary code: every answer
// is computed, never written by hand and never judged by a model.
//
// Families are chosen for tasks a strong core usually gets right but not
// always -- long exact arithmetic, calendars, counting, modular arithmetic,
// constraint puzzles, program tracing -- so there is headroom to measure.
// Nothing in src/ imports this file: the benchmark never trains Rouge.

export const FAMILIES = [
  "arithmetic",
  "date-offset",
  "weekday",
  "letter-count",
  "modpow",
  "base-conversion",
  "knights",
  "ordering",
  "trace",
  "list-ops",
] as const;

export type Family = (typeof FAMILIES)[number];

/** "no_answer": nothing in the reply could be read as an answer. */
export type Verdict = "correct" | "wrong" | "no_answer";

export type BenchTask = {
  id: string;
  family: Family;
  prompt: string;
  /** The computed answer, for tests; never printed by the eval. */
  expected: string;
  check(reply: string): Verdict;
};

const FORMAT =
  'Finish your reply with one final line of the form "Answer: <your answer>".';

// --- seeded randomness -----------------------------------------------------

function hash(seed: string) {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i += 1) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^ (h >>> 16)) >>> 0;
}

export type Rng = () => number;

/** mulberry32, seeded from a string. */
export function rngOf(seed: string): Rng {
  let a = hash(seed);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const int = (r: Rng, lo: number, hi: number) =>
  lo + Math.floor(r() * (hi - lo + 1));
const pick = <T>(r: Rng, items: readonly T[]) =>
  items[int(r, 0, items.length - 1)]!;
function shuffled<T>(r: Rng, items: readonly T[]) {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = int(r, 0, i);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}
const fmt = (n: number) => n.toLocaleString("en-US");

// --- reading a reply -------------------------------------------------------

/**
 * The part of a reply that states the answer: the last "Answer:" line, else
 * the last non-empty line. Lenient on purpose -- the benchmark measures
 * whether the answer is right, not whether the format was followed -- and
 * identical for every side.
 */
export function answerSegment(reply: string): string | null {
  const marked = [...reply.matchAll(/answer\s*(?:is)?\s*[:：]\s*(.+)$/gim)].at(
    -1,
  )?.[1];
  const line =
    marked ??
    reply
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .at(-1);
  if (!line) return null;
  const cleaned = line
    .replace(/\\boxed\{([^}]*)\}/g, "$1")
    .replace(/[*`$_]/g, "")
    .trim();
  return cleaned || null;
}

/** The first number of the segment, or of what follows its last "=". */
export function numberIn(segment: string): number | null {
  const tail = segment.includes("=")
    ? segment.slice(segment.lastIndexOf("=") + 1)
    : segment;
  const match = tail.match(/[−-]?\d{1,3}(?:,\d{3})+(?!\d)|[−-]?\d+/);
  if (!match) return null;
  const value = Number(match[0].replace(/,/g, "").replace("−", "-"));
  return Number.isSafeInteger(value) ? value : null;
}

const numeric =
  (expected: number) =>
  (reply: string): Verdict => {
    const segment = answerSegment(reply);
    const value = segment === null ? null : numberIn(segment);
    if (value === null) return "no_answer";
    return value === expected ? "correct" : "wrong";
  };

// --- families --------------------------------------------------------------

function arithmetic(r: Rng) {
  const a = int(r, 10_000, 99_999);
  const b = int(r, 10_000, 99_999);
  const c = int(r, 1_000, 9_999);
  const d = int(r, 1_000, 9_999);
  const e = int(r, 100, 9_999);
  const value = a * b - c * d + e;
  return {
    prompt: `Compute exactly: ${fmt(a)} × ${fmt(b)} − ${fmt(c)} × ${fmt(d)} + ${fmt(e)}. ${FORMAT}`,
    expected: String(value),
    check: numeric(value),
  };
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
const DAY_MS = 86_400_000;
const iso = (date: Date) => date.toISOString().slice(0, 10);
const spoken = (date: Date) =>
  `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;

function randomDate(r: Rng, fromYear: number, toYear: number) {
  const from = Date.UTC(fromYear, 0, 1);
  const to = Date.UTC(toYear, 11, 31);
  return new Date(from + int(r, 0, Math.floor((to - from) / DAY_MS)) * DAY_MS);
}

/** An ISO date, or "5 March 2031" / "March 5, 2031", in the segment. */
export function dateIn(segment: string): string | null {
  const isoMatch = segment.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (isoMatch) return isoMatch[0];
  const month = `(${MONTHS.join("|")})`;
  const dm = segment.match(
    new RegExp(`\\b(\\d{1,2})\\s+${month},?\\s+(\\d{4})`, "i"),
  );
  const md = segment.match(
    new RegExp(`${month}\\s+(\\d{1,2}),?\\s+(\\d{4})`, "i"),
  );
  const parts = dm
    ? { day: dm[1]!, month: dm[2]!, year: dm[3]! }
    : md
      ? { day: md[2]!, month: md[1]!, year: md[3]! }
      : null;
  if (!parts) return null;
  const m =
    MONTHS.findIndex(
      (name) => name.toLowerCase() === parts.month.toLowerCase(),
    ) + 1;
  return `${parts.year}-${String(m).padStart(2, "0")}-${parts.day.padStart(2, "0")}`;
}

function dateOffset(r: Rng) {
  const start = randomDate(r, 1995, 2045);
  const days = int(r, 150, 4_000) * (r() < 0.3 ? -1 : 1);
  const target = new Date(start.getTime() + days * DAY_MS);
  const expected = iso(target);
  return {
    prompt: `What is the date ${fmt(Math.abs(days))} days ${days < 0 ? "before" : "after"} ${spoken(start)}? Give it as YYYY-MM-DD. ${FORMAT}`,
    expected,
    check: (reply: string): Verdict => {
      const segment = answerSegment(reply);
      const found = segment === null ? null : dateIn(segment);
      if (!found) return "no_answer";
      return found === expected ? "correct" : "wrong";
    },
  };
}

function weekday(r: Rng) {
  const date = randomDate(r, 1600, 2400);
  const expected = WEEKDAYS[date.getUTCDay()]!;
  const past = date.getTime() < Date.UTC(2026, 0, 1);
  return {
    prompt: `On which day of the week ${past ? "did" : "will"} ${spoken(date)} fall (proleptic Gregorian calendar)? ${FORMAT}`,
    expected,
    check: (reply: string): Verdict => {
      const segment = answerSegment(reply);
      if (!segment) return "no_answer";
      const named = WEEKDAYS.filter((day) =>
        new RegExp(`\\b${day}\\b`, "i").test(segment),
      );
      if (!named.length) return "no_answer";
      return named.length === 1 && named[0] === expected ? "correct" : "wrong";
    },
  };
}

const WORDS = [
  "barrier",
  "strawberry",
  "referral",
  "mirror",
  "terrier",
  "narrator",
  "corridor",
  "error",
  "horror",
  "carrier",
  "sorrow",
  "arrears",
  "retrieve",
  "embarrass",
  "necessary",
  "successor",
  "possession",
  "assessment",
  "mississippi",
  "tennessee",
  "committee",
  "bookkeeper",
  "balloon",
  "coffee",
  "parallel",
  "illusion",
  "millennium",
  "occurrence",
  "accommodate",
  "address",
  "harass",
  "vacuum",
  "rhythm",
  "banana",
  "cinnamon",
  "pepper",
  "letter",
  "butter",
  "giraffe",
  "possess",
  "reservoir",
  "entrepreneur",
  "questionnaire",
  "irresistible",
  "unnecessary",
  "independent",
  "government",
  "environment",
  "restaurant",
  "temperature",
  "definitely",
  "separate",
  "calendar",
  "cemetery",
  "argument",
  "beginning",
  "believe",
  "committed",
  "conscience",
  "existence",
  "foreign",
  "grammar",
  "guarantee",
  "harassment",
  "immediate",
  "intelligence",
  "knowledge",
  "library",
  "maintenance",
  "noticeable",
  "occasionally",
  "perseverance",
  "privilege",
  "recommend",
  "reference",
  "relevant",
  "schedule",
  "sentence",
  "tomorrow",
  "tragedy",
  "vegetable",
  "weird",
  "whether",
  "yacht",
  "zucchini",
  "assassin",
  "difference",
  "engineer",
  "freezer",
  "greenery",
  "keeper",
  "needle",
  "referee",
  "settee",
  "teepee",
  "overseer",
  "renewal",
  "severe",
  "reverence",
  "terror",
  "rarer",
  "tartar",
  "starter",
  "treaty",
  "street",
  "attempt",
  "statistics",
  "tattoo",
  "potato",
  "tomato",
  "stutter",
  "tentative",
];

const COUNTED = ["e", "r", "s", "t", "n", "a", "o", "i", "l", "c"];

function letterCount(r: Rng) {
  for (;;) {
    const words = Array.from({ length: int(r, 10, 14) }, () => pick(r, WORDS));
    const text = words.join(" ");
    const letter = pick(r, COUNTED);
    const count = [...text].filter((ch) => ch === letter).length;
    if (count < 6) continue;
    return {
      prompt: `How many times does the letter "${letter}" occur in the following text? Text: "${text}". ${FORMAT}`,
      expected: String(count),
      check: numeric(count),
    };
  }
}

function modpow(r: Rng) {
  const base = int(r, 3, 97);
  const exponent = int(r, 150, 999);
  const modulus = int(r, 1_000, 9_999);
  let result = 1n;
  let b = BigInt(base) % BigInt(modulus);
  let e = BigInt(exponent);
  const m = BigInt(modulus);
  while (e > 0n) {
    if (e & 1n) result = (result * b) % m;
    b = (b * b) % m;
    e >>= 1n;
  }
  const value = Number(result);
  return {
    prompt: `What is the remainder when ${base}^${exponent} is divided by ${fmt(modulus)}? ${FORMAT}`,
    expected: String(value),
    check: numeric(value),
  };
}

function baseConversion(r: Rng) {
  const n = int(r, 2_000_000, 90_000_000);
  const base = int(r, 3, 9);
  const expected = n.toString(base);
  return {
    prompt: `Write the decimal number ${fmt(n)} in base ${base}. ${FORMAT}`,
    expected,
    check: (reply: string): Verdict => {
      const segment = answerSegment(reply);
      if (!segment) return "no_answer";
      const tail = segment.includes("=")
        ? segment.slice(segment.lastIndexOf("=") + 1)
        : segment;
      const digits = tail.match(/\d[\d ]*\d|\d/)?.[0].replace(/ /g, "");
      if (!digits) return "no_answer";
      return digits.replace(/^0+(?=\d)/, "") === expected ? "correct" : "wrong";
    },
  };
}

// Knights always tell the truth, knaves always lie. Puzzles are generated
// from a hidden assignment and kept only if exactly one assignment fits.
const ISLANDERS = ["Ava", "Ben", "Cleo", "Dev", "Eli"];

type Statement = { text: string; holds: (knight: boolean[]) => boolean };

function statementFor(r: Rng, speaker: number): Statement {
  const others = ISLANDERS.map((_, i) => i).filter((i) => i !== speaker);
  const [x, y] = shuffled(r, others) as [number, number];
  const X = ISLANDERS[x]!;
  const Y = ISLANDERS[y]!;
  const n = int(r, 1, 4);
  const count = (k: boolean[]) => k.filter(Boolean).length;
  return pick(r, [
    { text: `${X} is a knight.`, holds: (k: boolean[]) => k[x]! },
    { text: `${X} is a knave.`, holds: (k: boolean[]) => !k[x] },
    {
      text: `${X} and ${Y} are both knights.`,
      holds: (k: boolean[]) => k[x]! && k[y]!,
    },
    {
      text: `At least one of ${X} and ${Y} is a knave.`,
      holds: (k: boolean[]) => !k[x] || !k[y],
    },
    {
      text: `${X} and ${Y} are the same kind.`,
      holds: (k: boolean[]) => k[x] === k[y],
    },
    {
      text: `${X} and ${Y} are different kinds.`,
      holds: (k: boolean[]) => k[x] !== k[y],
    },
    {
      text: `Exactly ${n} of us five ${n === 1 ? "is a knight" : "are knights"}.`,
      holds: (k: boolean[]) => count(k) === n,
    },
    {
      text: `If ${X} is a knight, then so is ${Y}.`,
      holds: (k: boolean[]) => !k[x] || k[y]!,
    },
  ]);
}

export function knightsSolutions(statements: Statement[]) {
  const solutions: boolean[][] = [];
  for (let mask = 0; mask < 1 << ISLANDERS.length; mask += 1) {
    const k = ISLANDERS.map((_, i) => Boolean(mask & (1 << i)));
    if (statements.every((s, i) => s.holds(k) === k[i])) solutions.push(k);
  }
  return solutions;
}

function knights(r: Rng) {
  for (;;) {
    const hidden = ISLANDERS.map(() => r() < 0.5);
    if (hidden.every(Boolean) || !hidden.some(Boolean)) continue;
    const statements = ISLANDERS.map((_, speaker) => {
      for (let tries = 0; tries < 100; tries += 1) {
        const s = statementFor(r, speaker);
        if (s.holds(hidden) === hidden[speaker]) return s;
      }
      return null;
    });
    if (statements.some((s) => s === null)) continue;
    const solutions = knightsSolutions(statements as Statement[]);
    if (solutions.length !== 1) continue;
    const expectedNames = ISLANDERS.filter((_, i) => hidden[i]);
    const lines = ISLANDERS.map(
      (name, i) => `${name} says: "${statements[i]!.text}"`,
    ).join("\n");
    return {
      prompt: `On an island, knights always tell the truth and knaves always lie. Each of the five islanders Ava, Ben, Cleo, Dev and Eli is either a knight or a knave.\n${lines}\nWhich of them are knights? List the knights' names, separated by commas. ${FORMAT}`,
      expected: expectedNames.join(", "),
      check: (reply: string): Verdict => {
        const segment = answerSegment(reply);
        if (!segment) return "no_answer";
        const scope = segment.split(/knaves?\b/i)[0]!;
        const named = ISLANDERS.filter((name) =>
          new RegExp(`\\b${name}\\b`, "i").test(scope),
        );
        if (!named.length) return "no_answer";
        return named.join(", ") === expectedNames.join(", ")
          ? "correct"
          : "wrong";
      },
    };
  }
}

// A race of six. Clues are true of a hidden finishing order and are added
// until exactly one order fits, then pruned while it still does.
const RUNNERS = ["Ada", "Bo", "Cy", "Di", "Ed", "Flo"];
const ORDINALS = ["first", "second", "third", "fourth", "fifth", "sixth"];

type Clue = { text: string; holds: (pos: number[]) => boolean };

function permutations(n: number): number[][] {
  if (n === 1) return [[0]];
  return permutations(n - 1).flatMap((p) =>
    Array.from({ length: n }, (_, i) => [
      ...p.slice(0, i),
      n - 1,
      ...p.slice(i),
    ]),
  );
}
const ORDERS = permutations(RUNNERS.length); // order[k] = runner in place k

function positionsOf(order: number[]) {
  const pos: number[] = [];
  order.forEach((runner, place) => (pos[runner] = place));
  return pos;
}

function clueFor(r: Rng, hidden: number[]): Clue {
  const x = int(r, 0, RUNNERS.length - 1);
  let y = int(r, 0, RUNNERS.length - 2);
  if (y >= x) y += 1;
  const X = RUNNERS[x]!;
  const Y = RUNNERS[y]!;
  const kind = int(r, 0, 5);
  const truth = hidden;
  if (kind === 0) {
    const [a, b, A, B] = truth[x]! < truth[y]! ? [x, y, X, Y] : [y, x, Y, X];
    return {
      text: `${A} finished ahead of ${B}.`,
      holds: (p) => p[a]! < p[b]!,
    };
  }
  if (kind === 1 && Math.abs(truth[x]! - truth[y]!) === 1) {
    const [a, b, A, B] = truth[x]! > truth[y]! ? [x, y, X, Y] : [y, x, Y, X];
    return {
      text: `${A} finished directly behind ${B}.`,
      holds: (p) => p[a]! === p[b]! + 1,
    };
  }
  if (kind === 2) {
    const gap = Math.abs(truth[x]! - truth[y]!) - 1;
    return {
      text: `Exactly ${gap} runner${gap === 1 ? "" : "s"} finished between ${X} and ${Y}.`,
      holds: (p) => Math.abs(p[x]! - p[y]!) - 1 === gap,
    };
  }
  if (kind === 3 && truth[x]! > 0 && truth[x]! < RUNNERS.length - 1) {
    return {
      text: `${X} was neither first nor last.`,
      holds: (p) => p[x]! > 0 && p[x]! < RUNNERS.length - 1,
    };
  }
  if (kind === 4) {
    let place = int(r, 0, RUNNERS.length - 2);
    if (place >= truth[x]!) place += 1;
    return {
      text: `${X} did not finish ${ORDINALS[place]}.`,
      holds: (p) => p[x] !== place,
    };
  }
  const [a, b, A, B] = truth[x]! < truth[y]! ? [x, y, X, Y] : [y, x, Y, X];
  return { text: `${B} did not beat ${A}.`, holds: (p) => p[a]! < p[b]! };
}

export function orderingSolutions(clues: Clue[]) {
  return ORDERS.map(positionsOf).filter((pos) =>
    clues.every((c) => c.holds(pos)),
  );
}

function ordering(r: Rng) {
  for (;;) {
    const hidden = positionsOf(pick(r, ORDERS));
    const clues: Clue[] = [];
    for (let i = 0; i < 40 && orderingSolutions(clues).length !== 1; i += 1)
      clues.push(clueFor(r, hidden));
    if (orderingSolutions(clues).length !== 1) continue;
    // Prune clues that are not needed: a minimal set is a harder puzzle.
    for (const clue of shuffled(r, clues)) {
      const without = clues.filter((c) => c !== clue);
      if (orderingSolutions(without).length === 1)
        clues.splice(clues.indexOf(clue), 1);
    }
    const place = int(r, 0, RUNNERS.length - 1);
    const expected = RUNNERS[hidden.indexOf(place)]!;
    return {
      prompt: `Six runners -- Ada, Bo, Cy, Di, Ed and Flo -- finished a race with no ties.\n${clues.map((c) => `- ${c.text}`).join("\n")}\nWho finished ${ORDINALS[place]}? ${FORMAT}`,
      expected,
      check: (reply: string): Verdict => {
        const segment = answerSegment(reply);
        if (!segment) return "no_answer";
        const named = RUNNERS.filter((name) =>
          new RegExp(`\\b${name}\\b`, "i").test(segment),
        );
        if (!named.length) return "no_answer";
        return named.length === 1 && named[0] === expected
          ? "correct"
          : "wrong";
      },
    };
  }
}

// Python semantics: floor division and a remainder with the divisor's sign.
export const pyMod = (a: number, b: number) => ((a % b) + b) % b;
export const pyDiv = (a: number, b: number) => Math.floor(a / b);

type Update = {
  code: string;
  run: (x: number, y: number, i: number) => [number, number];
};

const X_UPDATES: Update[] = [
  { code: "x = x - y + i", run: (x, y, i) => [x - y + i, y] },
  { code: "x = x + 2 * i", run: (x, y, i) => [x + 2 * i, y] },
  { code: "x = y // 2 + x", run: (x, y) => [pyDiv(y, 2) + x, y] },
  { code: "x = x - 3 * i", run: (x, y, i) => [x - 3 * i, y] },
  { code: "x = (x + y) // 3", run: (x, y) => [pyDiv(x + y, 3), y] },
];
const Y_UPDATES: Update[] = [
  { code: "y = 3 * y - i", run: (x, y, i) => [x, 3 * y - i] },
  { code: "y = y + x % 7", run: (x, y) => [x, y + pyMod(x, 7)] },
  { code: "y = y // 2 - x", run: (x, y) => [x, pyDiv(y, 2) - x] },
  { code: "y = y - i * i", run: (x, y, i) => [x, y - i * i] },
  { code: "x, y = y, x + 1", run: (x, y) => [y, x + 1] },
];
const FINALS = [
  { code: "print(x - y)", run: (x: number, y: number) => x - y },
  { code: "print(2 * x + y)", run: (x: number, y: number) => 2 * x + y },
  {
    code: "print(x * y % 1000)",
    run: (x: number, y: number) => pyMod(x * y, 1000),
  },
];

function trace(r: Rng) {
  for (;;) {
    const x0 = int(r, -20, 40);
    const y0 = int(r, -20, 40);
    const n = int(r, 7, 12);
    const k = int(r, 3, 5);
    const m = int(r, 2, 4);
    const first = pick(r, X_UPDATES);
    const second = pick(r, Y_UPDATES);
    const other = pick(
      r,
      [...X_UPDATES, ...Y_UPDATES].filter((u) => u !== first && u !== second),
    );
    const final = pick(r, FINALS);
    let x = x0;
    let y = y0;
    let bounded = true;
    for (let i = 0; i < n; i += 1) {
      [x, y] =
        pyMod(x + i, k) === 0
          ? first.run(x, y, i)
          : pyMod(y - i, m) === 0
            ? second.run(x, y, i)
            : other.run(x, y, i);
      if (Math.abs(x) > 1e7 || Math.abs(y) > 1e7) bounded = false;
    }
    if (!bounded) continue;
    const value = final.run(x, y);
    const code = [
      `x = ${x0}`,
      `y = ${y0}`,
      `for i in range(${n}):`,
      `    if (x + i) % ${k} == 0:`,
      `        ${first.code}`,
      `    elif (y - i) % ${m} == 0:`,
      `        ${second.code}`,
      `    else:`,
      `        ${other.code}`,
      final.code,
    ].join("\n");
    return {
      prompt: `What does this Python 3 program print?\n\n\`\`\`python\n${code}\n\`\`\`\n\n${FORMAT}`,
      expected: String(value),
      check: numeric(value),
    };
  }
}

function listOps(r: Rng) {
  for (;;) {
    const size = int(r, 14, 18);
    const values = Array.from({ length: size }, () => int(r, 1, 60));
    // Make sure some numbers repeat.
    for (let i = 0; i < 3; i += 1)
      values[int(r, 0, size - 1)] = pick(r, values);
    const counts = new Map<number, number>();
    for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
    const variant = int(r, 0, 1);
    let value: number;
    let instruction: string;
    if (variant === 0) {
      const kept = values
        .filter((v) => counts.get(v) === 1)
        .sort((a, b) => b - a);
      if (kept.length < 5) continue;
      value = kept.filter((_, i) => i % 2 === 0).reduce((s, v) => s + v, 0);
      instruction =
        "Remove every number that occurs more than once in the list (remove all of its copies). Sort the remaining numbers from largest to smallest. What is the sum of the numbers in the 1st, 3rd, 5th, ... positions of the sorted list?";
    } else {
      const distinct = [...new Set(values)].sort((a, b) => a - b);
      if (distinct.length < 6) continue;
      const median = distinct[Math.floor(distinct.length / 2)]!;
      const above = values.filter((v) => v > median);
      value = above.length * 100 + (above.reduce((s, v) => s + v, 0) % 100);
      instruction = `Let M be the element at position ${Math.floor(distinct.length / 2) + 1} (counting from 1) of the list's distinct values sorted in increasing order. Let C be how many entries of the original list (with repeats) are greater than M, and S their sum. What is 100 × C + (S mod 100)?`;
    }
    return {
      prompt: `List: [${values.join(", ")}]\n${instruction} ${FORMAT}`,
      expected: String(value),
      check: numeric(value),
    };
  }
}

const GENERATORS: Record<Family, (r: Rng) => Omit<BenchTask, "id" | "family">> =
  {
    arithmetic,
    "date-offset": dateOffset,
    weekday,
    "letter-count": letterCount,
    modpow,
    "base-conversion": baseConversion,
    knights,
    ordering,
    trace,
    "list-ops": listOps,
  };

/** Every task depends only on (seed, family, index): order-independent. */
export function generateBenchmark(
  seed: string,
  perFamily: number,
): BenchTask[] {
  return FAMILIES.flatMap((family) =>
    Array.from({ length: perFamily }, (_, index) => ({
      id: `${family}-${index + 1}`,
      family,
      ...GENERATORS[family](rngOf(`${seed}:${family}:${index}`)),
    })),
  );
}
