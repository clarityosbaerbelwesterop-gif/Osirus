import { EFFORT_LABEL, EFFORTS, type EffortId } from "@/lib/product/surfaces";

/**
 * Effort during setup. A suggestion is plain text the person can still change.
 * It is not a badge, a selected pill, or a percent. A level they chose is
 * the select's value and is marked as chosen.
 */
export function EffortField(props: {
  chosen: EffortId | null;
  suggestion: EffortId | null;
  onChoose: (effort: EffortId | null) => void;
}) {
  return (
    <label>
      <span className="effort-label-row">
        Effort
        {props.chosen ? (
          <span className="effort-chosen-mark">Chosen</span>
        ) : null}
      </span>
      <select
        aria-label="Effort"
        value={props.chosen ?? ""}
        data-chosen={props.chosen ? "true" : "false"}
        onChange={(event) => {
          const value = event.target.value;
          props.onChoose(value ? (value as EffortId) : null);
        }}
      >
        <option value="">Choose an effort</option>
        {EFFORTS.map((item) => (
          <option key={item} value={item}>
            {EFFORT_LABEL[item]}
          </option>
        ))}
      </select>
      {props.chosen || !props.suggestion ? null : (
        <p className="effort-suggestion">
          Suggestion: {EFFORT_LABEL[props.suggestion]}
        </p>
      )}
    </label>
  );
}
