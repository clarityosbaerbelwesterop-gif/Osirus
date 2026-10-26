import type { GatewayModel } from "./models";

// Which model answers, when the person does not choose one (everywhere but
// Code). Three classes:
//   top       hard, long or high-stakes work, and expert bots
//   balanced  ordinary questions
//   fast      greetings and one-liners
// A thread keeps its model; a harder follow-up may move it up a class,
// never down, so one conversation stays on one model unless it needs more.

export type ModelTier = "top" | "balanced" | "fast";

const TIER_ORDER: Record<ModelTier, number> = { fast: 0, balanced: 1, top: 2 };

export function higherTier(a: ModelTier, b: ModelTier): ModelTier {
  return TIER_ORDER[a] >= TIER_ORDER[b] ? a : b;
}

const SMALL =
  /(mini|nano|small|lite|flash|haiku|tiny|\b[1-9](\.\d)?b\b|[-_/][1-9](\.\d)?b\b|-8b|-7b|-3b|-1b|e2b|e4b)/i;

/** The class a listed model belongs to. */
export function tierOf(model: Pick<GatewayModel, "id" | "rank">): ModelTier {
  if (SMALL.test(model.id)) return "fast";
  // Ranks below 30 are the frontier families (models.ts FAMILY_RANK).
  return model.rank < 30 ? "top" : "balanced";
}

const HARD =
  /(architekt|architect|strateg|analys|analyz|vergleich|compare|beweis|prove|proof|optimi[sz]|refactor|sicherheit|security|migration|konzept|business ?plan|vertrag|contract|rechtlich|legal|steuer|\btax|finanz|financ|algorithm|mathe|\bmath|gleichung|equation|integral|recherch|research|detailliert|detailed|schritt f(ü|ue)r schritt|step by step|debug|stack ?trace|exception|traceback|datenbank|database|schema|skalier|scal(e|ing)|performance|produktion|production|deploy|kubernetes|terraform|machine learning|neuronal|neural)/i;

const TRIVIAL =
  /^(hi|hallo|hey|moin|servus|danke|thanks|thank you|ok|okay|super|cool|gut|ja|nein|yes|no|guten (morgen|tag|abend)|wie geht'?s|what'?s up)[\s!.?]*$/i;

/**
 * How demanding one message is. Size, code, expert topics, several asks and a
 * long thread each push it up; a greeting is "fast".
 */
export function classifyDifficulty(input: {
  message: string;
  historyChars?: number;
  attachments?: number;
}): { tier: ModelTier; score: number } {
  const text = input.message.trim();
  if (TRIVIAL.test(text)) return { tier: "fast", score: 0 };
  let score = 0;
  if (text.length > 1500) score += 2;
  else if (text.length > 280) score += 1;
  if (/```|^\s{4}\S|;\s*$|\bfunction\b|=>|\bdef \w+\(|\bclass \w+/m.test(text))
    score += 1;
  const hard = text.match(new RegExp(HARD.source, "gi"))?.length ?? 0;
  score += Math.min(hard, 2) * 1.5;
  const asks =
    (text.match(/\?/g)?.length ?? 0) +
    (text.match(/^\s*(\d+[.)]|[-*•])\s+/gm)?.length ?? 0);
  if (asks >= 3) score += 1;
  if ((input.historyChars ?? 0) > 8000) score += 1;
  if ((input.attachments ?? 0) > 0) score += 1;
  if (score >= 3) return { tier: "top", score };
  if (score >= 1 || text.length > 60) return { tier: "balanced", score };
  return { tier: "fast", score };
}

const EXPERT_ROLE =
  /(engineer|ingenieur|entwickler|developer|programm|software|code|coding|database|datenbank|\bdb\b|sql|architect|architekt|devops|security|sicherheit|analyst|analys|data scien|research|forsch|wissenschaft|scien|legal|jurist|anwalt|recht|finance|finanz|steuer|accountant|buchhalt|mathemat|arzt|doctor|medic|cto|ceo|cfo|strateg|consult|berater|manufact|hersteller|produktion)/i;

const LIGHT_ROLE =
  /(übersetz|translat|smalltalk|chit-?chat|begrüß|greeter|faq|zusammenfass|summari[sz]|social|caption|emoji|witz|joke)/i;

const CODING_ROLE =
  /(engineer|ingenieur|entwickler|developer|programm|software|code|coding|database|datenbank|\bdb\b|sql|devops|frontend|backend|fullstack|api)/i;

type BotLike = {
  name: string;
  description?: string | null;
  system_prompt?: string | null;
};

function botText(bot: BotLike) {
  return `${bot.name} ${bot.description ?? ""} ${(bot.system_prompt ?? "").slice(0, 2000)}`;
}

/** A bot's fixed class, from what it does: experts get the top class. */
export function botTier(bot: BotLike): ModelTier {
  const text = botText(bot);
  if (EXPERT_ROLE.test(text)) return "top";
  if (LIGHT_ROLE.test(text)) return "fast";
  return "balanced";
}

/** Bots whose work is software or data prefer the strongest coding models. */
export function botWantsCoding(bot: BotLike) {
  return CODING_ROLE.test(botText(bot));
}

const CODING_MODEL =
  /(coder|codestral|devstral|claude|gpt-5|qwen3|kimi|glm-(4\.[5-9]|5)|deepseek-(v3|r1|chat)|grok-(4|code))/i;

/**
 * The models to try for a class, best first: the class itself, then the next
 * stronger, then the weaker. `prefer` moves coding or reasoning models to
 * the front within each class.
 */
export function candidatesFor(
  models: readonly GatewayModel[],
  tier: ModelTier,
  options: { coding?: boolean; reasoning?: boolean; limit?: number } = {},
): GatewayModel[] {
  const order: ModelTier[] =
    tier === "top"
      ? ["top", "balanced", "fast"]
      : tier === "balanced"
        ? ["balanced", "top", "fast"]
        : ["fast", "balanced", "top"];
  const score = (model: GatewayModel) => {
    let value = model.rank;
    if (options.coding && CODING_MODEL.test(model.id)) value -= 6;
    // Thinking models are slow; outside "reasoning" they go after the rest.
    if (model.reasoning && !options.reasoning) value += 8;
    if (options.reasoning && model.reasoning) value -= 30;
    return value;
  };
  const out: GatewayModel[] = [];
  for (const wanted of order) {
    out.push(
      ...models
        .filter((model) => tierOf(model) === wanted)
        .sort((a, b) => score(a) - score(b) || a.ref.localeCompare(b.ref)),
    );
  }
  return out.slice(0, options.limit ?? out.length);
}

/** Error codes after which the next candidate is tried (before any text). */
export const FALLBACK_CODES = new Set([
  "rate_limited",
  "provider_unavailable",
  "model_not_configured",
  "insufficient_credit",
  "credential_rejected",
  "provider_not_configured",
  "timeout",
  "empty_response",
  "invalid_stream",
  "provider_error",
]);

const REASONING_TASK =
  /(beweis|prove|proof|mathe|\bmath|gleichung|equation|integral|ableitung|derivative|wahrscheinlich|probabilit|logik|logic|rätsel|puzzle|optimier|optimi[sz]e|algorithm)/i;

/** Proofs, maths and puzzles go to a thinking model first. */
export function wantsReasoning(message: string) {
  return REASONING_TASK.test(message);
}
