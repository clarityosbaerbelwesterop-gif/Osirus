import { appendFileSync, writeFileSync } from "node:fs";
import { expect, it } from "vitest";
import { listGatewayModels, type GatewayModel } from "@/lib/gateway/models";
import { candidatesFor, tierOf } from "@/lib/gateway/routing";
import { completeGateway } from "@/lib/gateway/stream";

// Which top-class models the configured keys can really use. The production
// gateway lists every provider's models; the strongest free and paid ones of
// each provider get a question with one checkable answer. Those that answer
// correctly and in time are exported as OSIRUS_VERIFIED_TOP_MODELS (via
// GITHUB_ENV) for the runtime sync. Prints model ids and timings, never keys.

const QUESTION =
  "Ein Lager hat 17 Regale mit je 23 Kisten. Wie viele Kisten sind es? Antworte nur mit der Zahl.";
const PER_PROVIDER = 4;
const CONCURRENCY = 6;
const TIMEOUT_MS = 40_000;
const MAX_MS = 20_000;
const KEEP = 6;

type Result = {
  ref: string;
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
    return [true, false].flatMap((free) =>
      candidatesFor(
        own.filter((model) => model.free === free),
        "top",
        { limit: PER_PROVIDER },
      ),
    );
  });
}

it("finds the top-class models the keys can really use", async () => {
  const { models, providers } = await listGatewayModels();
  for (const provider of providers)
    console.log(
      `provider ${provider.id}: ${provider.ok ? "listed" : "list unreadable"}, ${provider.models} chat models`,
    );
  const picked = pick(
    models,
    providers.map((provider) => provider.id),
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

  const verified = results
    .filter((row) => row.correct && row.ms <= MAX_MS)
    .sort((a, b) => a.rank - b.rank || a.ms - b.ms)
    .slice(0, KEEP)
    .map((row) => row.ref);
  writeFileSync(
    process.env.PROBE_OUT ?? "probe-top-models.json",
    JSON.stringify({ verified, results }, null, 2),
  );
  console.log(`verified top models: ${verified.join(", ") || "none"}`);
  if (process.env.GITHUB_ENV && verified.length > 0)
    appendFileSync(
      process.env.GITHUB_ENV,
      `OSIRUS_VERIFIED_TOP_MODELS=${verified.join(",")}\n`,
    );
  expect(picked.length).toBeGreaterThan(0);
});
