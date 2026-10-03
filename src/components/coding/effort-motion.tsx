"use client";

import { effortScale, type EffortId } from "@/lib/product/surfaces";

/**
 * Motion for a coding run that has actually started. The mark grows with the
 * effort. It is not a label, a badge, or a percent, and it is absent unless
 * the run is in progress.
 */
export function EffortMotion({
  effort,
  active,
}: {
  effort: EffortId | null;
  active: boolean;
}) {
  if (!active || !effort) return null;
  const scale = effortScale(effort);
  return (
    <div
      className="effort-motion"
      data-effort={effort}
      data-scale={scale}
      style={{ ["--effort-scale" as string]: String(scale) }}
      aria-hidden="true"
    >
      {Array.from({ length: scale }, (_, index) => (
        <span key={index} className="effort-orb" />
      ))}
    </div>
  );
}
