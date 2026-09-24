-- Close the crash window between a slice's budget charge and its checkpoint.
--
-- The agent loop used to call consume_budget and only afterwards write the
-- stage checkpoint. A crash in between left the budget incremented and the
-- resume reading the previous checkpoint, so the same model and tool calls
-- were charged again. checkpoint_stage_budget inserts the attempt's
-- settlement row, the checkpoint and the budget update in one transaction.
-- Replaying an attempt that already settled writes nothing and charges nothing.
--
-- The settlement row is the idempotency key. It is not a second scheduler.

CREATE TABLE IF NOT EXISTS osirus.stage_budget_settlements (
  attempt_id uuid NOT NULL,
  run_id uuid NOT NULL,
  stage_id uuid,
  model_calls integer NOT NULL DEFAULT 0,
  tool_calls integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT stage_budget_settlements_pkey PRIMARY KEY (attempt_id),
  CONSTRAINT stage_budget_settlements_counts_check CHECK (model_calls >= 0 AND tool_calls >= 0),
  CONSTRAINT stage_budget_settlements_attempt_id_fkey FOREIGN KEY (attempt_id) REFERENCES osirus.run_attempts(id) ON DELETE CASCADE,
  CONSTRAINT stage_budget_settlements_run_id_fkey FOREIGN KEY (run_id) REFERENCES osirus.runs(id) ON DELETE CASCADE,
  CONSTRAINT stage_budget_settlements_stage_id_fkey FOREIGN KEY (stage_id) REFERENCES osirus.run_stages(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS stage_budget_settlements_run_idx
  ON osirus.stage_budget_settlements (run_id);

ALTER TABLE osirus.stage_budget_settlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE osirus.stage_budget_settlements FORCE ROW LEVEL SECURITY;

CREATE POLICY stage_budget_settlements_access ON osirus.stage_budget_settlements
  AS PERMISSIVE FOR ALL TO public
  USING (osirus.can_access_run(run_id))
  WITH CHECK (osirus.can_manage_run(run_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON osirus.stage_budget_settlements TO osirus_app;

CREATE OR REPLACE FUNCTION osirus.checkpoint_stage_budget(
  p_run_id uuid,
  p_stage_id uuid,
  p_attempt_id uuid,
  p_label text,
  p_state jsonb,
  p_model_calls integer,
  p_tool_calls integer
)
RETURNS TABLE (
  version integer,
  exhausted boolean,
  reason text,
  charged_model_calls integer,
  charged_tool_calls integer
)
LANGUAGE plpgsql
AS $function$
DECLARE
  v_model integer;
  v_tool integer;
  v_state jsonb;
  v_checkpoint osirus.checkpoints;
  v_exhausted boolean := false;
  v_reason text := NULL;
  v_version integer;
BEGIN
  -- Same lock save_run_checkpoint takes, so two settlers of one run cannot
  -- interleave a charge and a checkpoint.
  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_run_id::text || ':checkpoint', 0)
  );

  IF NOT EXISTS (
    SELECT 1
      FROM osirus.run_attempts
     WHERE id = p_attempt_id
       AND run_id = p_run_id
       AND stage_id IS NOT DISTINCT FROM p_stage_id
  ) THEN
    RAISE EXCEPTION 'attempt_run_mismatch';
  END IF;

  -- This attempt already committed its checkpoint and its charge.
  IF EXISTS (
    SELECT 1
      FROM osirus.stage_budget_settlements
     WHERE attempt_id = p_attempt_id
  ) THEN
    SELECT c.version
      INTO v_version
      FROM osirus.checkpoints c
     WHERE c.run_id = p_run_id
     ORDER BY c.version DESC
     LIMIT 1;
    RETURN QUERY SELECT COALESCE(v_version, 0), false, NULL::text, 0, 0;
    RETURN;
  END IF;

  v_model := GREATEST(COALESCE(p_model_calls, 0), 0);
  v_tool := GREATEST(COALESCE(p_tool_calls, 0), 0);

  INSERT INTO osirus.stage_budget_settlements (
    attempt_id, run_id, stage_id, model_calls, tool_calls
  )
  VALUES (p_attempt_id, p_run_id, p_stage_id, v_model, v_tool);

  v_state := CASE
    WHEN jsonb_typeof(p_state) = 'object' THEN p_state
    ELSE '{}'::jsonb
  END;
  -- pendingBudget is the instruction to charge, not run state. The resume
  -- computes a fresh delta from the loop counts stored beside it.
  v_state := (v_state - 'pendingBudget') || jsonb_build_object(
    'budgetSettlement',
    jsonb_build_object(
      'attemptId', p_attempt_id,
      'modelCalls', v_model,
      'toolCalls', v_tool
    )
  );

  v_checkpoint := osirus.save_run_checkpoint(
    p_run_id, p_stage_id, p_label, v_state
  );

  IF v_model > 0 OR v_tool > 0 THEN
    SELECT b.exhausted, b.reason
      INTO v_exhausted, v_reason
      FROM osirus.consume_budget(
        p_run_id,
        'run',
        NULL::uuid,
        0::bigint,
        0::bigint,
        v_model,
        v_tool,
        0,
        0,
        0::bigint,
        0::numeric
      ) AS b;
  END IF;

  RETURN QUERY
    SELECT v_checkpoint.version,
           COALESCE(v_exhausted, false),
           v_reason,
           v_model,
           v_tool;
END;
$function$;
