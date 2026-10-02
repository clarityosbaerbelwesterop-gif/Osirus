import { darusProgram } from "./darus";
import { quasnirProgram } from "./quasnir";
import { rougeProgram } from "./rouge";
import type { ModelId, ModelProgram } from "./types";

/** Programs compiled into this branch. Missing ids are not answered. */
export const PROGRAMS: readonly ModelProgram[] = [
  rougeProgram,
  quasnirProgram,
  darusProgram,
];

export function programInBuild(id: string): ModelProgram | undefined {
  return PROGRAMS.find((program) => program.id === id);
}

export function programAvailability(): Record<ModelId, boolean> {
  return {
    rouge: Boolean(programInBuild("rouge")),
    quasnir: Boolean(programInBuild("quasnir")),
    darus: Boolean(programInBuild("darus")),
  };
}
