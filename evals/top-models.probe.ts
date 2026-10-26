import { appendFileSync, writeFileSync } from "node:fs";
import { expect, it } from "vitest";
import {
  BYTEZ_CANDIDATES,
  listGatewayModels,
  parseProviderModels,
  type GatewayModel,
} from "@/lib/gateway/models";
import { providerById } from "@/lib/gateway/providers";
import { candidatesFor, tierOf } from "@/lib/gateway/routing";
import { completeGateway } from "@/lib/gateway/stream";

// Which top-class models the configured keys can really use. The production
// gateway lists every provider's models; the strongest free and paid ones of
// each provider get a question with one checkable answer. Exported via
// GITHUB_ENV for the runtime sync:
//   OSIRUS_VERIFIED_TOP_MODELS  answered correctly and in time, best first
//   OSIRUS_UNFUNDED_PROVIDERS   every probed paid model refused for missing
//                               credit ("none" when no provider is)
// Prints model ids and timings, never keys.

const QUESTION =
  "Ein Lager hat 17 Regale mit je 23 Kisten. Wie viele Kisten sind es? Antworte nur mit der Zahl.";
// Few free calls per provider: the runtime sync probes the same free pool
// right after this and must not find it rate limited.
const FREE_PER_PROVIDER = 4;
const PAID_PER_PROVIDER = 2;
const CONCURRENCY = 6;
const TIMEOUT_MS = 40_000;
const MAX_MS = 20_000;
const KEEP = 6;

type Result = {
  ref: string;
  provider: string;
  free: boolean;
  reasoning: boolean;
  rank: number;
  correct: boolean;
  ms: number;
  outcome: string;
};

async function probe(model: GatewayModel): Promise<Result> {
  const started = Date.now();
  const base = {
    ref: model.ref,
    provider: model.provider,
    free: model.free,
    reasoning: model.reasoning,
    rank: model.rank,
  };
  try {
    const { text } = await completeGateway({
      ref: model.ref,
      messages: [{ role: "user", content: QUESTION }],
      maxTokens: 1024,
      signal: AbortSignal.timeout(TIMEOUT_MS),
      firstByteTimeoutMs: 30_000,
      idleTimeoutMs: 20_000,
    });
    const answer = text.trim();
    return {
      ...base,
      correct: /\b391\b/.test(answer),
      ms: Date.now() - started,
      outcome: answer ? "answered" : "empty",
    };
  } catch (error) {
    const code = (error as { code?: unknown })?.code;
    return {
      ...base,
      correct: false,
      ms: Date.now() - started,
      outcome: typeof code === "string" ? code : "error",
    };
  }
}

/** Per provider: its best free and its best paid top-class models. */
function pick(models: GatewayModel[], providers: string[]) {
  const top = models.filter((model) => tierOf(model) === "top");
  return providers.flatMap((provider) => {
    const own = top.filter((model) => model.provider === provider);
    return [
      ...candidatesFor(
        own.filter((model) => model.free),
        "top",
        { limit: FREE_PER_PROVIDER },
      ),
      ...candidatesFor(
        own.filter((model) => !model.free),
        "top",
        { limit: PAID_PER_PROVIDER },
      ),
    ];
  });
}

it("finds the top-class models the keys can really use", async () => {
  const { models, providers } = await listGatewayModels();
  for (const provider of providers)
    console.log(
      `provider ${provider.id}: ${provider.ok ? "listed" : "list unreadable"}, ${provider.models} chat models`,
    );
  // Bytez is probed below from its candidate list.
  const picked = pick(
    models,
    providers.map((provider) => provider.id).filter((id) => id !== "bytez"),
  );
  console.log(`probing ${picked.length} top-class models`);

  const results: Result[] = [];
  for (let index = 0; index < picked.length; index += CONCURRENCY)
    results.push(
      ...(await Promise.all(
        picked.slice(index, index + CONCURRENCY).map(probe),
      )),
    );
  for (const row of results)
    console.log(
      `${row.correct ? "PASS " : "FAIL "} ${row.ref} (${row.free ? "free" : "paid"}${row.reasoning ? ", thinks" : ""}) ${row.ms} ms ${row.outcome}`,
    );

  // Bytez hosts too many models to list: every candidate gets the question,
  // and only those that answer are offered.
  const bytez = providerById("bytez");
  const bytezResults = bytez
    ? await Promise.all(
        parseProviderModels(
          bytez,
          BYTEZ_CANDIDATES.map((id) => ({ id })),
        ).map(probe),
      )
    : [];
  for (const row of bytezResults)
    console.log(
      `${row.correct ? "PASS " : "FAIL "} ${row.ref} ${row.ms} ms ${row.outcome}`,
    );
  const bytezServed = bytezResults
    .filter((row) => row.correct)
    .map((row) => row.ref.slice("bytez:".length));

  const verified = [
    ...results,
    ...bytezResults.filter(
      (row) => tierOf({ id: row.ref, rank: row.rank }) === "top",
    ),
  ]
    .filter((row) => row.correct && row.ms <= MAX_MS)
    .sort((a, b) => a.rank - b.rank || a.ms - b.ms)
    .slice(0, KEEP)
    .map((row) => row.ref);
  const all = [...results, ...bytezResults];
  const unfunded = [...new Set(all.map((row) => row.provider))].filter(
    (provider) => {
      const paid = all.filter((row) => row.provider === provider && !row.free);
      return (
        paid.length > 0 &&
        paid.every((row) => row.outcome === "insufficient_credit")
      );
    },
  );
  writeFileSync(
    process.env.PROBE_OUT ?? "probe-top-models.json",
    JSON.stringify({ verified, unfunded, results: all }, null, 2),
  );
  console.log(`verified top models: ${verified.join(", ") || "none"}`);
  console.log(`paid models without credit: ${unfunded.join(", ") || "none"}`);
  if (process.env.GITHUB_ENV) {
    const lines = [
      `OSIRUS_UNFUNDED_PROVIDERS=${unfunded.join(",") || "none"}`,
      // Only when Bytez was asked: "none" keeps unserved models off the lists.
      ...(bytezResults.length
        ? [`OSIRUS_BYTEZ_MODELS=${bytezServed.join(",") || "none"}`]
        : []),
      ...(verified.length
        ? [`OSIRUS_VERIFIED_TOP_MODELS=${verified.join(",")}`]
        : []),
    ];
    appendFileSync(process.env.GITHUB_ENV, `${lines.join("\n")}\n`);
  }
  expect(picked.length).toBeGreaterThan(0);
});
