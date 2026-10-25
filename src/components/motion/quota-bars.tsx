/**
 * Two quota windows. Ratios and the refill sentence are display state.
 * The server does not supply live quota yet, so callers pass placeholders.
 * There is no control here to buy extra credit.
 */
export function QuotaBars({
  fiveHourRatio,
  weekRatio,
  fiveHourRefill,
  note,
}: {
  fiveHourRatio: number;
  weekRatio: number;
  fiveHourRefill: string | null;
  note?: string;
}) {
  return (
    <div className="quota" aria-label="Kontingent">
      <QuotaBar
        label="5-Stunden-Kontingent"
        ratio={fiveHourRatio}
        refill={fiveHourRefill}
      />
      <QuotaBar label="Wochenkontingent" ratio={weekRatio} refill={null} />
      {note ? <p className="quota-note">{note}</p> : null}
    </div>
  );
}

function QuotaBar({
  label,
  ratio,
  refill,
}: {
  label: string;
  ratio: number;
  refill: string | null;
}) {
  const clamped = Math.min(1, Math.max(0, ratio));
  const empty = clamped >= 1;
  return (
    <div className="quota-row">
      <div className="quota-label">
        <span>{label}</span>
        {empty && refill ? (
          <span className="quota-refill">{refill}</span>
        ) : null}
      </div>
      <div
        className="quota-track"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(clamped * 100)}
        aria-valuetext={
          empty && refill ? `${label}, aufgebraucht. ${refill}` : label
        }
      >
        <span
          className="quota-fill"
          data-empty={empty ? "true" : "false"}
          style={{ transform: `scaleX(${clamped})` }}
        />
      </div>
    </div>
  );
}

/** Placeholder window shown until quota is served by the backend. */
export const PLACEHOLDER_QUOTA = {
  fiveHourRatio: 0.15,
  weekRatio: 0.2,
  fiveHourRefill: null,
  note: "Platzhalter, bis das Kontingent vom Server kommt.",
} as const;
