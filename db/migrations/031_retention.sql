-- Storage limitation (Art. 5(1)(e) GDPR) for what Osirus keeps on its own.
--
-- The privacy policy keeps a § 312k cancellation as proof for three years
-- after the end of the year the contract ends, and then deletes it. The
-- table had no way to delete a row at all: no DELETE grant, no policy. The
-- scheduler's retention step (src/lib/privacy/retention.ts) deletes, as the
-- system, only rows past that period.

GRANT DELETE ON osirus.contract_cancellations TO osirus_app;

DROP POLICY IF EXISTS contract_cancellations_purge ON osirus.contract_cancellations;
-- Only rows past their period, and only by the system: a declaration that
-- is still proof cannot be deleted by anyone, a bulk DELETE included.
CREATE POLICY contract_cancellations_purge ON osirus.contract_cancellations
  AS PERMISSIVE FOR DELETE TO public
  USING (
    osirus.is_system()
    AND date_trunc('year', coalesce(effective_at, received_at))
        + interval '4 years' <= now()
  );

-- The retention step asks by window start; without an index it scans.
CREATE INDEX IF NOT EXISTS request_rate_limits_window_idx
  ON osirus.request_rate_limits (window_started_at);
