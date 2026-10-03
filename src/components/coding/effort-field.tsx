import { EFFORT_LABEL, EFFORTS, type EffortId } from "@/lib/product/surfaces";

/**
 * Effort during setup. A suggestion sits in this same select, only quieter.
 * A level the person chose is the marked value. No second word beside either.
 */
export function EffortField(props: {
  chosen: EffortId | null;
  suggestion: EffortId | null;
  onChoose: (effort: EffortId | null) => void;
}) {
  const suggested = !props.chosen && props.suggestion ? props.suggestion : null;
  return (
    <label>
      Effort
      <select
        aria-label="Effort"
        value={props.chosen ?? suggested ?? ""}
        data-chosen={props.chosen ? "true" : "false"}
        data-suggested={suggested ? "true" : "false"}
        onChange={(event) => {
          const value = event.target.value;
          props.onChoose(value ? (value as EffortId) : null);
        }}
      >
        {props.chosen || suggested ? null : <option value="" />}
        {EFFORTS.map((item) => (
          <option key={item} value={item}>
            {EFFORT_LABEL[item]}
          </option>
        ))}
      </select>
    </label>
  );
}
