/**
 * A single mark while a run is actually working. No label, no score,
 * and nothing when the run is idle, waiting, or finished.
 */
export function WorkingMotion({ active }: { active: boolean }) {
  if (!active) return null;
  return (
    <div className="work-motion" data-live="true" aria-hidden="true">
      <span />
    </div>
  );
}
