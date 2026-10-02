/**
 * One completion per selected program, native offline.
 * Confirms UNOROUTER_API_KEY only by a non-empty check. Never prints it.
 */
import { writeFileSync } from "node:fs";
import { pageWellFormed } from "../ai-lab/programs/completion";
import { observeSketch } from "../ai-lab/programs/harness";
import { darusProgram } from "../ai-lab/programs/darus";
import { quasnirProgram } from "../ai-lab/programs/quasnir";
import { rougeProgram } from "../ai-lab/programs/rouge";
import { answerWithProgram } from "../ai-lab/programs/serve";
import type { ModelProgram } from "../ai-lab/programs/types";

const offline = {
  checkpointPresent: false,
  checkpointValidated: false,
  runtimeOnline: false,
} as const;

const programs: readonly ModelProgram[] = [
  rougeProgram,
  quasnirProgram,
  darusProgram,
];

const MATCHA =
  "Write one short HTML page for a Matcha Latte store. Include an h1 that names the store and a short menu. Do not write any files.";

const CRM =
  "Code a small CRM design as one self-contained HTML page with contacts, a pipeline, and notes. Do not write files and do not claim a benchmark score.";

function keyPresent(): boolean {
  const value = process.env.UNOROUTER_API_KEY;
  return typeof value === "string" && value.trim().length > 0;
}

function redact(text: string): string {
  let out = text;
  for (const name of [
    "UNOROUTER_API_KEY",
    "UNOROUTER_API_KEY_1",
    "UNOROUTER_API_KEY_2",
    "UNOROUTER_API_KEY_3",
  ]) {
    const value = process.env[name];
    if (typeof value === "string" && value.trim().length > 0) {
      out = out.split(value).join("[REDACTED]");
    }
  }
  return out;
}

function htmlUsable(
  request: string,
  text: string,
  completion: string,
): boolean {
  return (
    completion === "page" &&
    pageWellFormed(request, text).ok &&
    !/withheld/i.test(text)
  );
}

async function once(program: ModelProgram, prompt: string, tag: string) {
  const started = Date.now();
  try {
    const answer = await answerWithProgram({
      program,
      native: offline,
      messages: [{ role: "user", content: prompt }],
      env: process.env,
    });
    const text = redact(answer.text);
    if (tag === "crm") {
      writeFileSync(`/tmp/osirus-crm-${program.id}.html`, text);
    } else {
      writeFileSync(`/tmp/osirus-matcha-${program.id}.html`, text);
    }
    return {
      model: program.id,
      tag,
      success: true,
      latencyMs: Date.now() - started,
      providerLatencyMs: answer.latencyMs,
      label: answer.userLabel,
      activity: answer.activity,
      routingReason: answer.routingReason,
      provenance: answer.provenance,
      checkpoint: answer.checkpoint,
      measuredEqual: answer.measuredEqual,
      trained: answer.trained,
      phases: answer.phases,
      arms: answer.armIds,
      htmlUsable: htmlUsable(prompt, text, answer.completion),
      completion: answer.completion,
      characters: text.length,
      outsideProgram: answer.outsideProgram,
      sketch: tag === "crm" ? observeSketch(program, text) : undefined,
      error: null,
    };
  } catch (error) {
    const message = redact(error instanceof Error ? error.message : "failed");
    return {
      model: program.id,
      tag,
      success: false,
      latencyMs: Date.now() - started,
      providerLatencyMs: null,
      label: program.ui.fallbackLabel,
      activity: null,
      routingReason: null,
      provenance: null,
      checkpoint: null,
      measuredEqual: false,
      trained: false,
      phases: [],
      arms: [],
      htmlUsable: false,
      completion: null,
      characters: 0,
      outsideProgram: null,
      sketch: undefined,
      error: message,
    };
  }
}

async function main(): Promise<void> {
  const mode = process.argv[2] ?? "matcha";
  if (!keyPresent()) {
    console.log(
      JSON.stringify({
        live: false,
        reason: "UNOROUTER_API_KEY absent",
      }),
    );
    return;
  }
  const prompt = mode === "crm" ? CRM : MATCHA;
  const tag = mode === "crm" ? "crm" : "matcha";
  const rows = [];
  for (const program of programs) {
    rows.push(await once(program, prompt, tag));
  }
  console.log(JSON.stringify({ live: true, rows }, null, 2));
}

await main();
