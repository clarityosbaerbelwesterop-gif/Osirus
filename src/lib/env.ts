import { z } from "zod";

const schema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  DATABASE_URL: z.string().url().optional(),
  NEON_AUTH_BASE_URL: z.string().url().optional(),
  NEON_AUTH_COOKIE_SECRET: z.string().min(32).optional(),
  NEON_AUTH_JWKS_URL: z.string().url().optional(),
  UNOROUTER_BASE_URL: z.string().url().optional(),
  UNOROUTER_API_KEY_1: z.string().min(1).optional(),
  UNOROUTER_API_KEY_2: z.string().min(1).optional(),
  UNOROUTER_API_KEY_3: z.string().min(1).optional(),
  // Lab fallback only. Distinct from UNOROUTER_API_KEY_1/2/3. Empty fails closed.
  UNOROUTER_API_KEY: z.string().min(1).optional(),
  LAB_FALLBACK_MODEL_ROUGE: z.string().min(1).optional(),
  LAB_FALLBACK_MODEL_QUASNIR: z.string().min(1).optional(),
  LAB_FALLBACK_MODEL_DARUS: z.string().min(1).optional(),
  LAB_NATIVE_RUNTIME_ONLINE: z.enum(["true", "false"]).optional(),
  LAB_COST_BUDGET_USD: z.string().min(1).optional(),
  OSIRUS_MODEL_FAST: z.string().min(1).optional(),
  OSIRUS_MODEL_STRONG: z.string().min(1).optional(),
  OSIRUS_MODEL_THINKING: z.string().min(1).optional(),
  OSIRUS_MODEL_CODING: z.string().min(1).optional(),
  OSIRUS_MODEL_RESEARCH: z.string().min(1).optional(),
  OSIRUS_MODEL_MATH: z.string().min(1).optional(),
  OSIRUS_MODEL_VERIFY: z.string().min(1).optional(),
  // AES-256-GCM key sealing connector/MCP/webhook credentials at rest. Unset
  // (or shorter than 32 characters) fails closed: every connection reports
  // NOT_CONFIGURED and sealing throws connector_key_not_configured.
  OSIRUS_CONNECTOR_KEY: z.string().min(32).optional(),
  // M49: free-model-first by default. "configured-first" tries a configured
  // (possibly paid) role model before the verified free pool.
  OSIRUS_MODEL_POLICY: z
    .enum(["free-first", "configured-first"])
    .default("free-first"),
  // Preference hints written by the runtime sync from /v1/models. The
  // runtime still discovers and verifies; an unlisted hint is ignored.
  OSIRUS_FREE_MODEL_PRIMARY: z.string().min(1).optional(),
  OSIRUS_FREE_MODEL_SECONDARY: z.string().min(1).optional(),
  OSIRUS_FREE_MODEL_TERTIARY: z.string().min(1).optional(),
  // Rouge 1 (M56): the foundation core. Unset means grok-4.6. A different
  // core is a migration decision made on evaluations, never a silent switch.
  ROUGE_CORE_MODEL: z.string().min(1).max(120).optional(),
  // Comma-separated substitute cores, in order, overriding the measured
  // list. Each must be a model the tournament evaluated.
  ROUGE_SUBSTITUTE_CORES: z.string().min(1).max(1000).optional(),
  OSIRUS_REASONING_EFFORT: z
    .enum(["low", "medium", "high", "xhigh"])
    .optional(),
  // Shared secret for POST /api/scheduler/tick. Unset means the scheduler
  // endpoint refuses every request; it is never open when unconfigured.
  OSIRUS_SCHEDULER_SECRET: z.string().min(32).optional(),
  VERCEL_GIT_COMMIT_SHA: z.string().min(1).optional(),
});

export const env = schema.parse(process.env);

export const serverKeys = () =>
  [
    env.UNOROUTER_API_KEY_1,
    env.UNOROUTER_API_KEY_2,
    env.UNOROUTER_API_KEY_3,
  ].filter((value): value is string => Boolean(value));
