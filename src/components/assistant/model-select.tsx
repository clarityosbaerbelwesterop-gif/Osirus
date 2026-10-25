"use client";

export type ModelOption = {
  id: string;
  label: string;
};

/**
 * Model menu. Empty means the key list is not known.
 * Not AI Elements. The slot matches Nexus UI ModelSelector (MIT)
 * https://github.com/victorcodess/nexus-ui
 */
export function ModelSelect(props: {
  label: string;
  value: string;
  options: readonly ModelOption[];
  disabled?: boolean;
  recommended?: boolean;
  chosen?: boolean;
  onChange: (id: string) => void;
}) {
  const empty = props.options.length === 0;
  return (
    <label className="model-select">
      <span className="model-select-label">
        {props.label}
        {props.recommended ? (
          <span className="badge badge-accent">Empfohlen</span>
        ) : null}
        {props.chosen ? <span className="badge">eigene Wahl</span> : null}
      </span>
      <select
        aria-label={props.label}
        value={empty ? "" : props.value}
        disabled={props.disabled || empty}
        onChange={(event) => props.onChange(event.target.value)}
      >
        {empty ? (
          <option value="">Bald verfügbar</option>
        ) : (
          props.options.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))
        )}
      </select>
    </label>
  );
}
