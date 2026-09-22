-- M6 durable workflow engine.
--
-- Execution today happens inside one HTTP request: run_stages are created up
-- front and walked by a local closure in src/lib/runtime/executor.ts. If that
-- request dies the rows stay in 'running' forever. This migration adds the
-- state a scheduler needs to claim work atomically, hold a lease on it, and
-- recover it when the holder disappears.
--
-- The Neon HTTP driver cannot run an interactive transaction (src/lib/db/client.ts
-- issues a fixed two-statement array), so scheduler atomicity lives in the
-- functions at the bottom of this file, following the precedent set by
-- osirus.append_run_event and osirus.save_run_checkpoint in 005.

-- ---------------------------------------------------------------------------
-- DAG edges.
--
-- run_stages.parent_stage_id models a single-parent tree. A stage that gathers
-- several predecessors needs many-to-many edges. run_id is carried denormalised
-- so the row is reachable by the same can_access_run policy as every other
-- run-scoped table, without a join inside the policy.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS osirus.run_stage_dependencies (
  run_id uuid NOT NULL,
  stage_id uuid NOT NULL,
  depends_on_stage_id uuid NOT NULL,
  kind text NOT NULL DEFAULT 'completion',
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (stage_id, depends_on_stage_id),
  CONSTRAINT run_stage_dependencies_no_self_edge CHECK (stage_id <> depends_on_stage_id),
  CONSTRAINT run_stage_dependencies_kind_check CHECK (kind = ANY (ARRAY['completion'::text, 'gather'::text, 'conditional'::text])),
  CONSTRAINT run_stage_dependencies_run_id_fkey FOREIGN KEY (run_id) REFERENCES osirus.runs(id) ON DELETE CASCADE,
  CONSTRAINT run_stage_dependencies_stage_id_fkey FOREIGN KEY (stage_id) REFERENCES osirus.run_stages(id) ON DELETE CASCADE,
  CONSTRAINT run_stage_dependencies_depends_on_fkey FOREIGN KEY (depends_on_stage_id) REFERENCES osirus.run_stages(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS run_stage_dependencies_depends_on_idx
  ON osirus.run_stage_dependencies (depends_on_stage_id);

CREATE INDEX IF NOT EXISTS run_stage_dependencies_run_idx
  ON osirus.run_stage_dependencies (run_id);

-- ---------------------------------------------------------------------------
-- Leases on run_attempts.
--
-- A separate worker_leases table would duplicate the attempt's identity, FKs
-- and RLS policy for no gain: an attempt already IS the record of one worker
-- taking one stage. The lease is columns on that row.
-- ---------------------------------------------------------------------------
ALTER TABLE osirus.run_attempts
  ADD COLUMN IF NOT EXISTS lease_owner text,
  ADD COLUMN IF NOT EXISTS lease_token uuid,
  ADD COLUMN IF NOT EXISTS lease_expires_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS heartbeat_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS slice_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS failure_class text,
  ADD COLUMN IF NOT EXISTS last_error text;

-- The original key is UNIQUE NULLS NOT DISTINCT (stage_id, attempt_number).
-- With NULLS NOT DISTINCT a run-level attempt (stage_id IS NULL) with
-- attempt_number 1 can exist only once in the whole table, across every tenant.
-- The table has no rows yet, so this is a latent defect rather than an outage,
-- but M6 writes attempts. Re-key it to include run_id.
ALTER TABLE osirus.run_attempts
  DROP CONSTRAINT IF EXISTS run_attempts_stage_id_attempt_number_key;

ALTER TABLE osirus.run_attempts
  ADD CONSTRAINT run_attempts_run_stage_attempt_key
  UNIQUE NULLS NOT DISTINCT (run_id, stage_id, attempt_number);

-- 'claimed' is held-but-not-started; 'lost' is a lease that expired while its
-- holder was still nominally running.
ALTER TABLE osirus.run_attempts DROP CONSTRAINT IF EXISTS run_attempts_status_check;

ALTER TABLE osirus.run_attempts
  ADD CONSTRAINT run_attempts_status_check CHECK (
    status = ANY (
      ARRAY[
        'created'::text,
        'claimed'::text,
        'running'::text,
        'completed'::text,
        'failed'::text,
        'cancelled'::text,
        'lost'::text
      ]
    )
  );

CREATE INDEX IF NOT EXISTS run_attempts_live_lease_idx
  ON osirus.run_attempts (lease_expires_at)
  WHERE status = ANY (ARRAY['claimed'::text, 'running'::text]);

CREATE INDEX IF NOT EXISTS run_attempts_stage_idx
  ON osirus.run_attempts (stage_id, attempt_number DESC);

-- ---------------------------------------------------------------------------
-- Scheduling policy on stages.
-- ---------------------------------------------------------------------------
ALTER TABLE osirus.run_stages
  ADD COLUMN IF NOT EXISTS worker_kind text,
  ADD COLUMN IF NOT EXISTS retry_policy jsonb NOT NULL DEFAULT '{"maxAttempts": 1}'::jsonb,
  ADD COLUMN IF NOT EXISTS failure_policy text NOT NULL DEFAULT 'fail_run',
  ADD COLUMN IF NOT EXISTS requires_verification boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS attempt_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS runnable_after timestamp with time zone;

ALTER TABLE osirus.run_stages DROP CONSTRAINT IF EXISTS run_stages_failure_policy_check;

ALTER TABLE osirus.run_stages
  ADD CONSTRAINT run_stages_failure_policy_check CHECK (
    failure_policy = ANY (ARRAY['fail_run'::text, 'block_run'::text, 'skip_stage'::text, 'continue'::text])
  );

ALTER TABLE osirus.run_stages DROP CONSTRAINT IF EXISTS run_stages_attempt_count_check;

ALTER TABLE osirus.run_stages
  ADD CONSTRAINT run_stages_attempt_count_check CHECK (attempt_count >= 0);

-- The claim scan is global across tenants: runs_active_idx leads with
-- workspace_id and cannot serve it.
CREATE INDEX IF NOT EXISTS run_stages_claimable_idx
  ON osirus.run_stages (runnable_after NULLS FIRST, run_id, ordinal)
  WHERE status = ANY (ARRAY['pending'::text, 'blocked'::text]);

-- ---------------------------------------------------------------------------
-- Budgets.
--
-- One table covers the run, stage and worker levels rather than three near
-- identical ones. A NULL ceiling means unbounded for that dimension.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS osirus.run_budgets (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL,
  scope text NOT NULL,
  scope_id uuid,
  max_input_tokens bigint,
  max_output_tokens bigint,
  max_model_calls integer,
  max_tool_calls integer,
  max_attempts integer,
  max_repair_rounds integer,
  max_wall_clock_ms bigint,
  max_cost_usd numeric(14,8),
  consumed_input_tokens bigint NOT NULL DEFAULT 0,
  consumed_output_tokens bigint NOT NULL DEFAULT 0,
  consumed_model_calls integer NOT NULL DEFAULT 0,
  consumed_tool_calls integer NOT NULL DEFAULT 0,
  consumed_attempts integer NOT NULL DEFAULT 0,
  consumed_repair_rounds integer NOT NULL DEFAULT 0,
  consumed_wall_clock_ms bigint NOT NULL DEFAULT 0,
  consumed_cost_usd numeric(14,8) NOT NULL DEFAULT 0,
  exhausted_reason text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT run_budgets_scope_check CHECK (scope = ANY (ARRAY['run'::text, 'stage'::text, 'worker'::text])),
  CONSTRAINT run_budgets_scope_key UNIQUE NULLS NOT DISTINCT (run_id, scope, scope_id),
  CONSTRAINT run_budgets_run_id_fkey FOREIGN KEY (run_id) REFERENCES osirus.runs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS run_budgets_run_idx ON osirus.run_budgets (run_id, scope);

CREATE TRIGGER run_budgets_touch_updated_at
  BEFORE UPDATE ON osirus.run_budgets
  FOR EACH ROW EXECUTE FUNCTION osirus.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Tenant policy. No new table may bypass RLS.
-- ---------------------------------------------------------------------------
ALTER TABLE osirus.run_stage_dependencies ENABLE ROW LEVEL SECURITY;
ALTER TABLE osirus.run_stage_dependencies FORCE ROW LEVEL SECURITY;

CREATE POLICY run_stage_dependencies_access ON osirus.run_stage_dependencies
  AS PERMISSIVE FOR ALL TO public
  USING (osirus.can_access_run(run_id))
  WITH CHECK (osirus.can_manage_run(run_id));

ALTER TABLE osirus.run_budgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE osirus.run_budgets FORCE ROW LEVEL SECURITY;

CREATE POLICY run_budgets_access ON osirus.run_budgets
  AS PERMISSIVE FOR ALL TO public
  USING (osirus.can_access_run(run_id))
  WITH CHECK (osirus.can_manage_run(run_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON osirus.run_stage_dependencies TO osirus_app;

GRANT SELECT, INSERT, UPDATE, DELETE ON osirus.run_budgets TO osirus_app;

-- ---------------------------------------------------------------------------
-- osirus.claim_next_stage
--
-- Atomically takes one runnable stage and opens an attempt against it. This is
-- the whole concurrency story: FOR UPDATE ... SKIP LOCKED means two schedulers
-- racing for work take different rows rather than blocking or double-claiming,
-- and the dependency check sits inside the same statement as the lock, so it
-- cannot be invalidated by a predecessor completing concurrently.
--
-- Expired leases are reclaimed here rather than by a sweeper process: a dead
-- worker's stage simply becomes claimable again the next time anyone looks.
-- Returns NULL when there is no runnable work.
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
  v_attempt_number integer;
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

  -- Attempts are bounded here, not by the caller: a caller that forgets cannot
  -- produce an unbounded retry loop.
  IF v_stage.attempt_count >= v_max_attempts THEN
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
         attempt_count = v_stage.attempt_count + 1,
         started_at = COALESCE(started_at, now())
   WHERE id = v_stage.id;

  RETURN v_attempt;
END;
$function$;

-- ---------------------------------------------------------------------------
-- osirus.heartbeat_attempt
--
-- Extends a lease, fenced on lease_token rather than on the worker id. A worker
-- id can be reused across restarts; the token is minted fresh on every claim,
-- so a stalled worker that wakes after its stage was reclaimed finds zero rows
-- matched and must abort instead of writing over newer work. Returns false when
-- the lease was already taken away, which is the signal for a worker to stop
-- rather than keep writing to a stage someone else now owns.
CREATE OR REPLACE FUNCTION osirus.heartbeat_attempt(
  p_attempt_id uuid,
  p_lease_token uuid,
  p_lease_seconds integer DEFAULT 60
)
RETURNS boolean
LANGUAGE plpgsql
AS $function$
DECLARE
  v_updated integer;
BEGIN
  IF p_lease_seconds IS NULL OR p_lease_seconds <= 0 OR p_lease_seconds > 3600 THEN
    RAISE EXCEPTION 'invalid_lease_seconds';
  END IF;

  UPDATE osirus.run_attempts
     SET heartbeat_at = now(),
         lease_expires_at = now() + make_interval(secs => p_lease_seconds),
         status = CASE WHEN status = 'claimed' THEN 'running' ELSE status END
   WHERE id = p_attempt_id
     AND lease_token = p_lease_token
     AND status IN ('claimed', 'running')
     AND lease_expires_at > now();

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated = 1;
END;
$function$;

-- ---------------------------------------------------------------------------
-- osirus.finish_attempt
--
-- Closes an attempt and moves its stage in the same statement, so a crash can
-- never leave a completed attempt attached to a running stage. Only the lease
-- holder may finish; a worker whose lease expired is rejected, which is what
-- stops a resurrected zombie from overwriting newer work.
CREATE OR REPLACE FUNCTION osirus.finish_attempt(
  p_attempt_id uuid,
  p_lease_token uuid,
  p_attempt_status text,
  p_stage_status text,
  p_output jsonb DEFAULT NULL,
  p_failure_class text DEFAULT NULL,
  p_last_error text DEFAULT NULL,
  p_retry_delay_seconds integer DEFAULT 0
)
RETURNS boolean
LANGUAGE plpgsql
AS $function$
DECLARE
  v_attempt osirus.run_attempts;
BEGIN
  IF p_attempt_status NOT IN ('completed', 'failed', 'cancelled', 'lost') THEN
    RAISE EXCEPTION 'invalid_attempt_status';
  END IF;
  IF p_stage_status NOT IN ('completed', 'failed', 'blocked', 'waiting', 'skipped', 'cancelled') THEN
    RAISE EXCEPTION 'invalid_stage_status';
  END IF;

  UPDATE osirus.run_attempts
     SET status = p_attempt_status,
         completed_at = now(),
         lease_owner = NULL,
         lease_token = NULL,
         lease_expires_at = NULL,
         slice_count = slice_count + 1,
         failure_class = COALESCE(p_failure_class, failure_class),
         last_error = COALESCE(p_last_error, last_error)
   WHERE id = p_attempt_id
     AND lease_token = p_lease_token
     AND status IN ('claimed', 'running')
     AND lease_expires_at > now()
  RETURNING * INTO v_attempt;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  UPDATE osirus.run_stages
     SET status = p_stage_status,
         output = COALESCE(p_output, output),
         completed_at = CASE
           WHEN p_stage_status IN ('completed', 'failed', 'skipped', 'cancelled') THEN now()
           ELSE completed_at
         END,
         runnable_after = CASE
           WHEN p_stage_status = 'blocked' AND p_retry_delay_seconds > 0
             THEN now() + make_interval(secs => p_retry_delay_seconds)
           ELSE NULL
         END
   WHERE id = v_attempt.stage_id;

  RETURN true;
END;
$function$;

-- ---------------------------------------------------------------------------
-- osirus.consume_budget
--
-- Increments consumption and reports whether a ceiling is now breached, in one
-- statement, so two concurrent workers cannot both read "under budget" and
-- both proceed. A NULL ceiling means that dimension is unbounded. Once a
-- budget is exhausted the reason is recorded and stays recorded.
CREATE OR REPLACE FUNCTION osirus.consume_budget(
  p_run_id uuid,
  p_scope text,
  p_scope_id uuid,
  p_input_tokens bigint DEFAULT 0,
  p_output_tokens bigint DEFAULT 0,
  p_model_calls integer DEFAULT 0,
  p_tool_calls integer DEFAULT 0,
  p_attempts integer DEFAULT 0,
  p_repair_rounds integer DEFAULT 0,
  p_wall_clock_ms bigint DEFAULT 0,
  p_cost_usd numeric DEFAULT 0
)
RETURNS TABLE (exhausted boolean, reason text)
LANGUAGE plpgsql
AS $function$
DECLARE
  v_row osirus.run_budgets;
  v_reason text;
BEGIN
  UPDATE osirus.run_budgets
     SET consumed_input_tokens = consumed_input_tokens + COALESCE(p_input_tokens, 0),
         consumed_output_tokens = consumed_output_tokens + COALESCE(p_output_tokens, 0),
         consumed_model_calls = consumed_model_calls + COALESCE(p_model_calls, 0),
         consumed_tool_calls = consumed_tool_calls + COALESCE(p_tool_calls, 0),
         consumed_attempts = consumed_attempts + COALESCE(p_attempts, 0),
         consumed_repair_rounds = consumed_repair_rounds + COALESCE(p_repair_rounds, 0),
         consumed_wall_clock_ms = consumed_wall_clock_ms + COALESCE(p_wall_clock_ms, 0),
         consumed_cost_usd = consumed_cost_usd + COALESCE(p_cost_usd, 0)
   WHERE run_id = p_run_id
     AND scope = p_scope
     AND scope_id IS NOT DISTINCT FROM p_scope_id
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    -- No ceiling configured for this scope means unbounded, not blocked.
    RETURN QUERY SELECT false, NULL::text;
    RETURN;
  END IF;

  v_reason := CASE
    WHEN v_row.max_input_tokens IS NOT NULL AND v_row.consumed_input_tokens > v_row.max_input_tokens THEN 'input_tokens'
    WHEN v_row.max_output_tokens IS NOT NULL AND v_row.consumed_output_tokens > v_row.max_output_tokens THEN 'output_tokens'
    WHEN v_row.max_model_calls IS NOT NULL AND v_row.consumed_model_calls > v_row.max_model_calls THEN 'model_calls'
    WHEN v_row.max_tool_calls IS NOT NULL AND v_row.consumed_tool_calls > v_row.max_tool_calls THEN 'tool_calls'
    WHEN v_row.max_attempts IS NOT NULL AND v_row.consumed_attempts > v_row.max_attempts THEN 'attempts'
    WHEN v_row.max_repair_rounds IS NOT NULL AND v_row.consumed_repair_rounds > v_row.max_repair_rounds THEN 'repair_rounds'
    WHEN v_row.max_wall_clock_ms IS NOT NULL AND v_row.consumed_wall_clock_ms > v_row.max_wall_clock_ms THEN 'wall_clock'
    WHEN v_row.max_cost_usd IS NOT NULL AND v_row.consumed_cost_usd > v_row.max_cost_usd THEN 'cost'
    ELSE NULL
  END;

  IF v_reason IS NOT NULL AND v_row.exhausted_reason IS NULL THEN
    UPDATE osirus.run_budgets SET exhausted_reason = v_reason WHERE id = v_row.id;
  END IF;

  RETURN QUERY SELECT (v_reason IS NOT NULL), COALESCE(v_row.exhausted_reason, v_reason);
END;
$function$;
