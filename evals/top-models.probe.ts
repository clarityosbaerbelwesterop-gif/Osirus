import { appendFileSync, writeFileSync } from "node:fs";
import { expect, it } from "vitest";
import {
  BYTEZ_CANDIDATES,
  GATED_SEEDS,
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
//   OSIRUS_SERVED_MODELS        models of the gated gateways (Kunya, B.AI,
//                               AIHubMix, ShortAPI) that answered both
//                               questions; only these are offered
// Prints model ids and timings, never keys.

const QUESTION =
  "Ein Lager hat 17 Regale mit je 23 Kisten. Wie viele Kisten sind es? Antworte nur mit der Zahl.";
// The second question for the gated gateways: a common trap for weak models.
const TRAP =
  "Welche Zahl ist größer: 9.11 oder 9.9? Antworte nur mit der größeren Zahl.";
const checks: Record<string, (answer: string) => boolean> = {
  [QUESTION]: (answer: string) => /\b391\b/.test(answer),
  [TRAP]: (answer: string) =>
    /\b9[.,]9\b/.test(answer) && !/\b9[.,]11\b/.test(answer.slice(-40)),
};
// Gated gateways rate-limit hard (Kunya's free plan: about 20 calls an hour,
// then "retry_after": 3600): one call at a time with a pause, a capped
// number per gateway, the seeds (measured before) with one question and new
// candidates with both, and a stop at the first rate limit.
const GATED_PER_PROVIDER = 8;
const GATED_GAP_MS = 3_000;
// Verified top models kept: the strongest paid ones and, for the free plan,
// the strongest free ones.
const KEEP_FREE = 4;
// Free calls per provider. UnoRouter gets few: the runtime sync probes the
// same free pool right after this and must not find it rate limited.
const FREE_PER_PROVIDER = 6;
const FREE_UNOROUTER = 4;
// Everyday-class models probed where a provider has few top-class ones, to
// show whether the provider answers at all (reported, never verified as top).
const BALANCED_FALLBACK = 3;
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

async function probe(
  model: GatewayModel,
  question: string = QUESTION,
): Promise<Result> {
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
      messages: [{ role: "user", content: question }],
      maxTokens: 1024,
      signal: AbortSignal.timeout(TIMEOUT_MS),
      firstByteTimeoutMs: 30_000,
      idleTimeoutMs: 20_000,
    });
    const answer = text.trim();
    return {
      ...base,
      correct: checks[question](answer),
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

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

/**
 * A gated gateway: its seeds, then its strongest listed models, one at a
 * time. Stops at a missing balance (the whole account is unfunded) or at a
 * rate limit (measured another time; the last list stays).
 */
async function probeGated(provider: string, own: GatewayModel[]) {
  const seeds = (GATED_SEEDS[provider as keyof typeof GATED_SEEDS] ?? [])
    .map((id) => own.find((model) => model.id === id))
    .filter((model): model is GatewayModel => Boolean(model));
  const ranked = candidatesFor(own, "top", { limit: GATED_PER_PROVIDER });
  const queue = [
    ...seeds,
    ...ranked.filter((model) => !seeds.includes(model)),
  ].slice(0, GATED_PER_PROVIDER);
  const results: Result[] = [];
  for (const model of queue) {
    const first = await probe(model);
    if (first.outcome === "rate_limited") {
      results.push(first);
      break;
    }
    if (first.correct && seeds.includes(model)) results.push(first);
    else if (first.correct) {
      await sleep(GATED_GAP_MS);
      const second = await probe(model, TRAP);
      results.push({
        ...first,
        correct: second.correct,
        outcome: second.correct ? first.outcome : `trap ${second.outcome}`,
      });
    } else results.push(first);
    if (first.outcome === "insufficient_credit") break;
    await sleep(GATED_GAP_MS);
  }
  return results;
}

/** Per provider: its best free and its best paid top-class models. */
function pick(models: GatewayModel[], providers: string[]) {
  return providers.flatMap((provider) => {
    const own = models.filter((model) => model.provider === provider);
    const top = own.filter((model) => tierOf(model) === "top");
    const freeTop = candidatesFor(
      top.filter((model) => model.free),
      "top",
      { limit: provider === "unorouter" ? FREE_UNOROUTER : FREE_PER_PROVIDER },
    );
    const balanced =
      provider !== "unorouter" && freeTop.length < 2
        ? candidatesFor(
            own.filter((model) => model.free && tierOf(model) === "balanced"),
            "balanced",
            { limit: BALANCED_FALLBACK },
          )
        : [];
    return [
      ...freeTop,
      ...balanced,
      ...candidatesFor(
        top.filter((model) => !model.free),
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
      `provider ${provider.id}: ${provider.ok ? "listed" : `list unreadable${provider.status ? ` (HTTP ${provider.status})` : ""}`}, ${provider.models} chat models`,
    );
  // Bytez and the gated gateways are probed below, on their own terms.
  const gatedIds = providers
    .map((provider) => provider.id)
    .filter((id) => providerById(id)?.gated);
  const picked = pick(
    models,
    providers
      .map((provider) => provider.id)
      .filter((id) => id !== "bytez" && !gatedIds.includes(id)),
  );
  console.log(`probing ${picked.length} top-class models`);

  const results: Result[] = [];
  for (let index = 0; index < picked.length; index += CONCURRENCY)
    results.push(
      ...(await Promise.all(
        picked.slice(index, index + CONCURRENCY).map((model) => probe(model)),
      )),
    );
  for (const row of results)
    console.log(
      `${row.correct ? "PASS " : "FAIL "} ${row.ref} (${tierOf({ id: row.ref, rank: row.rank })}, ${row.free ? "free" : "paid"}${row.reasoning ? ", thinks" : ""}) ${row.ms} ms ${row.outcome}`,
    );

  // Bytez hosts too many models to list: every candidate gets the question,
  // and only those that answer are offered.
  const bytez = providerById("bytez");
  const bytezResults = bytez
    ? await Promise.all(
        parseProviderModels(
          bytez,
          BYTEZ_CANDIDATES.map((id) => ({ id })),
        ).map((model) => probe(model)),
      )
    : [];
  for (const row of bytezResults)
    console.log(
      `${row.correct ? "PASS " : "FAIL "} ${row.ref} ${row.ms} ms ${row.outcome}`,
    );
  const bytezServed = bytezResults
    .filter((row) => row.correct)
    .map((row) => row.ref.slice("bytez:".length));

  // The gated gateways: their whole lists, measured or not.
  const unserved = gatedIds.length
    ? (await listGatewayModels({ unserved: true })).models
    : [];
  const gatedResults: Result[] = [];
  for (const id of gatedIds) {
    const listed = unserved.filter((model) => model.provider === id);
    const spec = providerById(id);
    // An unreadable list (a rate limit on it, say): the seeds still get asked.
    const seeds = GATED_SEEDS[id as keyof typeof GATED_SEEDS] ?? [];
    const own =
      listed.length || !spec
        ? listed
        : parseProviderModels(
            spec,
            seeds.map((seed) =>
              id === "shortapi" ? { model: seed } : { id: seed },
            ),
          );
    const rows = await probeGated(id, own);
    for (const row of rows)
      console.log(
        `${row.correct ? "PASS " : "FAIL "} ${row.ref} (gated, ${tierOf({ id: row.ref, rank: row.rank })}) ${row.ms} ms ${row.outcome}`,
      );
    gatedResults.push(...rows);
  }
  const served = gatedResults
    .filter((row) => row.correct && row.ms <= MAX_MS)
    .map((row) => row.ref);

  const top = [...results, ...bytezResults, ...gatedResults]
    .filter((row) => tierOf({ id: row.ref, rank: row.rank }) === "top")
    .filter((row) => row.correct && row.ms <= MAX_MS)
    .sort((a, b) => a.rank - b.rank || a.ms - b.ms);
  // The strongest paid ones, and the strongest free ones so the free plan
  // keeps a measured lead of its own.
  const verified = [
    ...top.filter((row) => !row.free).slice(0, KEEP),
    ...top.filter((row) => row.free).slice(0, KEEP_FREE),
  ]
    .sort((a, b) => a.rank - b.rank || a.ms - b.ms)
    .map((row) => row.ref);
  const all = [...results, ...bytezResults, ...gatedResults];
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
  console.log(`served gated models: ${served.join(", ") || "none"}`);
  console.log(`paid models without credit: ${unfunded.join(", ") || "none"}`);
  if (process.env.GITHUB_ENV) {
    // A gated gateway cut short by its rate limit (Kunya's hourly limit,
    // after an earlier sync in the same hour) keeps the last full lists:
    // part of a measurement would drop models that answered before.
    const cutShort = gatedResults.some((row) => row.outcome === "rate_limited");
    const lines = [
      `OSIRUS_UNFUNDED_PROVIDERS=${unfunded.join(",") || "none"}`,
      // Only when Bytez was asked: "none" keeps unserved models off the lists.
      ...(bytezResults.length
        ? [`OSIRUS_BYTEZ_MODELS=${bytezServed.join(",") || "none"}`]
        : []),
      ...(verified.length && !cutShort
        ? [`OSIRUS_VERIFIED_TOP_MODELS=${verified.join(",")}`]
        : []),
      ...(gatedIds.length && !cutShort
        ? [`OSIRUS_SERVED_MODELS=${served.join(",") || "none"}`]
        : []),
    ];
    appendFileSync(process.env.GITHUB_ENV, `${lines.join("\n")}\n`);
  }
  expect(picked.length).toBeGreaterThan(0);
});
