export interface CurriculumStage {
  readonly id: string;
  readonly order: number;
  readonly objective: string;
  readonly mixtureId: string;
  /** Only the tiny CPU fixture may be executable in this milestone. */
  readonly executable: "none" | "tiny-linear-v1";
}

export function validateCurriculum(
  stages: readonly CurriculumStage[],
): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  const orders = new Set<number>();
  let executable = 0;
  for (const stage of stages) {
    if (!stage.id) errors.push("curriculum stage id is required");
    if (ids.has(stage.id))
      errors.push(`duplicate curriculum stage ${stage.id}`);
    ids.add(stage.id);
    if (orders.has(stage.order))
      errors.push(`duplicate curriculum order ${stage.order}`);
    orders.add(stage.order);
    if (!stage.objective) errors.push(`stage ${stage.id} missing objective`);
    if (!stage.mixtureId) errors.push(`stage ${stage.id} missing mixture`);
    if (stage.executable === "tiny-linear-v1") executable += 1;
    else if (stage.executable !== "none")
      errors.push(`unknown executable ${stage.executable}`);
  }
  const sorted = [...stages].sort((a, b) => a.order - b.order);
  sorted.forEach((stage, index) => {
    if (stage.order !== index)
      errors.push("curriculum orders must be contiguous from 0");
  });
  if (executable > 1)
    errors.push("only one executable fixture stage is allowed");
  return errors;
}
