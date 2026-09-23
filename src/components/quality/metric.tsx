import { formatPercent } from "@/lib/ui/labels";

export function Metric({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note?: string;
}) {
  return (
    <div className="metric">
      <span className="metric-label">{label}</span>
      <span className="metric-value">{value}</span>
      {note ? <span className="metric-note">{note}</span> : null}
    </div>
  );
}

/** A rate with its sample size, so a small sample is visibly small. */
export function rateText(value: number | null, sample: number) {
  if (value === null || sample === 0) return "—";
  return formatPercent(value);
}
