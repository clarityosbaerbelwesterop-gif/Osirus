import type { Capability } from "./types";
const tests: [Capability, RegExp][] = [
  [
    "coding",
    /\b(code|repo|git|typescript|javascript|python|bug|test|build|implement)\b/i,
  ],
  ["research", /\b(research|source|cite|evidence|investigate)\b/i],
  ["math_science", /\b(math|equation|calculate|physics|chemistry|proof)\b/i],
  ["data", /\b(csv|dataset|sql|analy[sz]e data|spreadsheet)\b/i],
];
export function routeCapabilities(input: string): Capability[] {
  const hits = tests.filter(([, r]) => r.test(input)).map(([c]) => c);
  return hits.length ? [...new Set(hits)] : ["general"];
}
