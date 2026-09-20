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
  OSIRUS_MODEL_FAST: z.string().min(1).optional(),
  OSIRUS_MODEL_STRONG: z.string().min(1).optional(),
  OSIRUS_MODEL_CODING: z.string().min(1).optional(),
  OSIRUS_MODEL_RESEARCH: z.string().min(1).optional(),
  OSIRUS_MODEL_MATH: z.string().min(1).optional(),
  OSIRUS_MODEL_VERIFY: z.string().min(1).optional(),
});

export const env = schema.parse(process.env);

export const serverKeys = () =>
  [
    env.UNOROUTER_API_KEY_1,
    env.UNOROUTER_API_KEY_2,
    env.UNOROUTER_API_KEY_3,
  ].filter((value): value is string => Boolean(value));
