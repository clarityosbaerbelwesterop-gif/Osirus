// Answers and uncertainty (M57).
//
// Rouge's solvers end their work with one line, "FINAL ANSWER: ...". This
// module pulls that answer out, puts candidates into a comparable form, and
// measures how much the independent attempts agree. Agreement between
// genuinely different approaches is Rouge's uncertainty signal: it decides
// whether an answer can stand or must be adjudicated.

const FINAL = /final answer\s*[:：]\s*(.+)$/im;

/** The answer a solver committed to, or its last non-empty line. */
export function extractFinal(text: string): string {
  const matches = [...text.matchAll(new RegExp(FINAL.source, "gim"))];
  const last = matches.at(-1)?.[1];
  if (last) return clean(last);
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  return clean(lines.at(-1) ?? "");
}

function clean(value: string) {
  let out = value.trim().replace(/\\boxed\{(.+)\}/, "$1");
  // Markers and a closing full stop can wrap each other ("**13**."): peel
  // until nothing changes.
  for (let previous = ""; previous !== out;) {
    previous = out;
    out = out
      .replace(/^[*`$]+|[*`$]+$/g, "")
      .replace(/[.。]$/, "")
      .replace(/^(?:final\s+)?answer\s*[:：]\s*/i, "")
      .trim();
  }
  return out;
}

/**
 * A comparable key: case, spacing, thousands separators and surrounding
 * punctuation do not make two answers different; different numbers do.
 */
export function answerKey(answer: string): string {
  const value = clean(answer).toLowerCase();
  const numeric = value.replace(/(\d),(?=\d{3}\b)/g, "$1").replace(/\s+/g, "");
  if (/^-?\d+(\.\d+)?$/.test(numeric)) return String(Number(numeric));
  return value
    .replace(/["'`*_]/g, "")
    .replace(/\s+/g, " ")
    .replace(/\s*([,;/:-])\s*/g, "$1")
    .trim();
}

export type Cluster = { key: string; answer: string; members: number[] };

export type Agreement = {
  clusters: Cluster[];
  top: Cluster | null;
  /** Share of attempts behind the leading answer, 0..1. */
  confidence: number;
  unanimous: boolean;
};

/** Group candidate answers; empty answers count as disagreement. */
export function agreementOf(answers: string[]): Agreement {
  const clusters: Cluster[] = [];
  answers.forEach((answer, index) => {
    const key = answerKey(answer);
    if (!key) return;
    const found = clusters.find((cluster) => cluster.key === key);
    if (found) found.members.push(index);
    else clusters.push({ key, answer, members: [index] });
  });
  clusters.sort((a, b) => b.members.length - a.members.length);
  const top = clusters[0] ?? null;
  const confidence =
    top && answers.length ? top.members.length / answers.length : 0;
  return {
    clusters,
    top,
    confidence,
    unanimous: Boolean(top) && top!.members.length === answers.length,
  };
}
