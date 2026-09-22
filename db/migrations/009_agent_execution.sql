-- Agent execution: slices, verification verdicts and the acceptance contract.
--
-- 008 gave a stage one shot per claim: every claim consumed a retry. A worker
-- that returns partial progress has to be re-claimed to continue, so under 008
-- a stage with maxAttempts = 1 could never yield and resume. This migration
-- separates the two counters. attempt_count still bounds retries after a
-- failure; slice_count bounds continuations, so neither a retry storm nor a
-- worker that yields forever can run unbounded.

ALTER TABLE osirus.run_stages
  ADD COLUMN IF NOT EXISTS slice_count integer NOT NULL DEFAULT 0;

-- The verdict, not just its label. verifier_status keeps the four-value
-- summary the UI filters on; this keeps the checks and the evidence behind it,
-- because "verified" without the evidence is an assertion, not a proof.
ALTER TABLE osirus.run_stages
  ADD COLUMN IF NOT EXISTS verification jsonb;

-- Which arm drove the run, and the contract it agreed to meet. The meta
-- verifier grades the finished run against this, so it has to be written
-- before execution rather than derived afterwards from the output.
ALTER TABLE osirus.runs
  ADD COLUMN IF NOT EXISTS arm_id text;

ALTER TABLE osirus.runs
  ADD COLUMN IF NOT EXISTS acceptance_contract jsonb;

CREATE INDEX IF NOT EXISTS approvals_run_idx
  ON osirus.approvals (run_id, created_at);

CREATE INDEX IF NOT EXISTS artifacts_run_idx
  ON osirus.artifacts (run_id, created_at);

CREATE OR REPLACE FUNCTION osirus.claim_next_stage(
  p_worker_id text,
  p_lease_seconds integer DEFAULT 60,
  p_run_id uuid DEFAULT NULL
)
RETURNS osirus.run_attempts
LANGUAGE plpgsql
AS $function$
DECLARE
  v_stage osirus.run_stages;
  v_attempt osirus.run_attempts;
  v_max_attempts integer;
  v_max_slices integer;
  v_attempt_number integer;
  v_last_status text;
  v_is_retry boolean;
BEGIN
  IF p_worker_id IS NULL OR length(p_worker_id) = 0 THEN
    RAISE EXCEPTION 'worker_id_required';
  END IF;
  IF p_lease_seconds IS NULL OR p_lease_seconds <= 0 OR p_lease_seconds > 3600 THEN
    RAISE EXCEPTION 'invalid_lease_seconds';
  END IF;

  -- Retire leases whose holder stopped heartbeating.
  UPDATE osirus.run_attempts a
     SET status = 'lost',
         completed_at = now(),
         failure_class = COALESCE(a.failure_class, 'lease_expired')
   WHERE a.status IN ('claimed', 'running')
     AND a.lease_expires_at IS NOT NULL
     AND a.lease_expires_at <= now()
     AND (p_run_id IS NULL OR a.run_id = p_run_id);

  -- A stage marked running with no live attempt behind it lost its worker.
  -- Send it back to blocked so it is claimable again.
  UPDATE osirus.run_stages s
     SET status = 'blocked'
   WHERE s.status = 'running'
     AND (p_run_id IS NULL OR s.run_id = p_run_id)
     AND NOT EXISTS (
       SELECT 1
         FROM osirus.run_attempts a
        WHERE a.stage_id = s.id
          AND a.status IN ('claimed', 'running')
     );

  SELECT s.*
    INTO v_stage
    FROM osirus.run_stages s
    JOIN osirus.runs r ON r.id = s.run_id
   WHERE s.status IN ('pending', 'blocked')
     AND (p_run_id IS NULL OR s.run_id = p_run_id)
     AND (s.runnable_after IS NULL OR s.runnable_after <= now())
     AND r.cancel_requested = false
     AND r.status NOT IN ('completed', 'failed', 'cancelled', 'cancelling')
     AND NOT EXISTS (
       SELECT 1
         FROM osirus.run_stage_dependencies d
         JOIN osirus.run_stages dep ON dep.id = d.depends_on_stage_id
        WHERE d.stage_id = s.id
          AND dep.status NOT IN ('completed', 'skipped')
     )
   ORDER BY s.runnable_after NULLS FIRST, s.run_id, s.ordinal
     FOR UPDATE OF s SKIP LOCKED
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  v_max_attempts := GREATEST(COALESCE((v_stage.retry_policy ->> 'maxAttempts')::integer, 1), 1);
  v_max_slices := GREATEST(COALESCE((v_stage.retry_policy ->> 'maxSlices')::integer, 64), 1);

  -- Slices are bounded independently of retries. A worker that keeps returning
  -- PROGRESS is making progress by contract, but nothing here trusts that
  -- contract to terminate on its own.
  IF v_stage.slice_count >= v_max_slices THEN
    UPDATE osirus.run_stages
       SET status = CASE WHEN failure_policy = 'skip_stage' THEN 'skipped' ELSE 'failed' END,
           completed_at = now()
     WHERE id = v_stage.id;
    RETURN NULL;
  END IF;

  -- Only a claim that follows a failed, lost or cancelled attempt is a retry.
  -- A claim that continues a stage which yielded mid-flight is not, or a stage
  -- allowed a single attempt could never resume after its first slice.
  SELECT a.status
    INTO v_last_status
    FROM osirus.run_attempts a
   WHERE a.stage_id = v_stage.id
   ORDER BY a.attempt_number DESC
   LIMIT 1;

  v_is_retry := v_last_status IS NULL
             OR v_last_status IN ('failed', 'lost', 'cancelled');

  -- Attempts are bounded here, not by the caller: a caller that forgets cannot
  -- produce an unbounded retry loop.
  IF v_is_retry AND v_stage.attempt_count >= v_max_attempts THEN
    UPDATE osirus.run_stages
       SET status = CASE WHEN failure_policy = 'skip_stage' THEN 'skipped' ELSE 'failed' END,
           completed_at = now()
     WHERE id = v_stage.id;
    RETURN NULL;
  END IF;

  -- Derive the attempt number from the attempts themselves, not from the
  -- denormalised counter. attempt_count is the retry ceiling; if the two ever
  -- disagree, trusting the counter produces a duplicate key against
  -- run_attempts_run_stage_attempt_key. Same MAX+1-under-lock shape as
  -- osirus.append_run_event.
  SELECT COALESCE(MAX(a.attempt_number), 0) + 1
    INTO v_attempt_number
    FROM osirus.run_attempts a
   WHERE a.stage_id = v_stage.id;

  INSERT INTO osirus.run_attempts (
    run_id, stage_id, attempt_number, worker_kind, status,
    lease_owner, lease_token, lease_expires_at, heartbeat_at, started_at
  )
  VALUES (
    v_stage.run_id, v_stage.id, v_attempt_number,
    COALESCE(v_stage.worker_kind, 'inline'), 'claimed',
    p_worker_id, gen_random_uuid(),
    now() + make_interval(secs => p_lease_seconds), now(), now()
  )
  RETURNING * INTO v_attempt;

  UPDATE osirus.run_stages
     SET status = 'running',
         attempt_count = v_stage.attempt_count + CASE WHEN v_is_retry THEN 1 ELSE 0 END,
         slice_count = v_stage.slice_count + 1,
         started_at = COALESCE(started_at, now())
   WHERE id = v_stage.id;

  RETURN v_attempt;
END;
$function$;

-- Record a verification verdict and its evidence together. Splitting them into
-- two calls leaves a window where the label says verified and the evidence is
-- missing, which is exactly the claim this engine must never make.
CREATE OR REPLACE FUNCTION osirus.record_verification(
  p_stage_id uuid,
  p_verifier_status text,
  p_verification jsonb
)
RETURNS boolean
LANGUAGE plpgsql
AS $function$
BEGIN
  IF p_verifier_status NOT IN ('unverified', 'verified', 'conflicted', 'rejected') THEN
    RAISE EXCEPTION 'invalid_verifier_status';
  END IF;

  UPDATE osirus.run_stages
     SET verifier_status = p_verifier_status,
         verification = p_verification
   WHERE id = p_stage_id;

  RETURN FOUND;
END;
$function$;
