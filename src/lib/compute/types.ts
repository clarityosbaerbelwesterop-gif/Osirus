import { z } from "zod";

// What can be computed, as data.
//
// Every request is a structured object, never source code. Expressions travel
// as strings, but they are parsed by a real math parser (mathjs in-process,
// sympy inside an isolated sandbox) and never handed to eval().

const expression = z
  .string()
  .min(1)
  .max(2000)
  // Math tokens only. Blocks attribute access, quoting and indexing tricks
  // before an expression reaches either parser.
  .regex(
    /^[\w\s+\-*/^().,=<>!|%']*$/,
    "expression_contains_disallowed_characters",
  )
  .refine((value) => !value.includes("__"), "expression_contains_dunder")
  // A dot is a decimal point, never attribute access. After an identifier or a
  // closing bracket it would be `obj.attr`, which math has no use for and which
  // is the first step of every Python sandbox escape.
  .refine(
    (value) => !/[A-Za-z_)\]]\s*\./.test(value),
    "expression_contains_attribute_access",
  );

const matrix = z
  .array(z.array(z.number().finite()).min(1).max(50))
  .min(1)
  .max(50);

export const computeRequestSchema = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("evaluate"),
    expression,
    scope: z
      .record(
        z.string().regex(/^[a-zA-Z]\w{0,30}$/),
        z.union([z.number().finite(), z.string().max(80)]),
      )
      .optional(),
  }),
  z.object({
    op: z.literal("solve"),
    equations: z.array(expression).min(1).max(10),
    variables: z
      .array(z.string().regex(/^[a-zA-Z]\w{0,30}$/))
      .min(1)
      .max(10),
  }),
  z.object({ op: z.literal("simplify"), expression }),
  z.object({
    op: z.literal("derivative"),
    expression,
    variable: z.string().regex(/^[a-zA-Z]\w{0,30}$/),
  }),
  z.object({
    op: z.literal("integrate"),
    expression,
    variable: z.string().regex(/^[a-zA-Z]\w{0,30}$/),
    lower: z.number().finite().optional(),
    upper: z.number().finite().optional(),
  }),
  z.object({
    op: z.literal("matrix"),
    operation: z.enum([
      "multiply",
      "inverse",
      "determinant",
      "transpose",
      "solve",
    ]),
    a: matrix,
    b: matrix.optional(),
  }),
  z.object({
    op: z.literal("statistics"),
    values: z.array(z.number().finite()).min(1).max(100_000),
  }),
  z.object({
    op: z.literal("convert"),
    value: z.number().finite(),
    from: z.string().min(1).max(60),
    to: z.string().min(1).max(60),
  }),
  z.object({
    op: z.literal("dimension"),
    expression,
    expectUnit: z.string().min(1).max(60).optional(),
  }),
]);

export type ComputeRequest = z.infer<typeof computeRequestSchema>;

export type ComputeResult = {
  ok: boolean;
  op: ComputeRequest["op"];
  provider: string;
  /** Machine-readable value: number, string, matrix, record of solutions. */
  value?: unknown;
  /** Human-readable form of the value. */
  text?: string;
  unit?: string;
  /** True for a symbolic or exact result, false for a numeric approximation. */
  exact?: boolean;
  /** How it was computed, so a verifier can tell methods apart. */
  method: string;
  error?: string;
};

export interface ComputeProvider {
  readonly id: string;
  supports(request: ComputeRequest): boolean;
  compute(
    request: ComputeRequest,
    signal?: AbortSignal,
  ): Promise<ComputeResult>;
}
