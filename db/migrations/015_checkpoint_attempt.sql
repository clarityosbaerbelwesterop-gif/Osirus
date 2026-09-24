-- Count a slice's run-budget attempt in the same transaction as its checkpoint.
--
-- driveSlices used to call consume_budget(attempts => 1) after
-- checkpoint_stage_budget had already committed. A crash in that gap left
-- the stage settled and the attempt uncounted, so a later slice could pass
-- a ceiling the run had already spent. The attempt now rides the settlement
-- row. Replaying an attempt that already settled writes nothing and charges
-- nothing, including the attempt. This is not a second scheduler.

ALTER TABLE osirus.stage_budget_settlements
  ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0;

ALTER TABLE osirus.stage_budget_settlements
  DROP CONSTRAINT IF EXISTS stage_budget_settlements_attempts_check;

ALTER TABLE osirus.stage_budget_settlements
  ADD CONSTRAINT stage_budget_settlements_attempts_check CHECK (attempts >= 0);

-- CREATE OR REPLACE cannot change the argument list. The 7-argument
-- function from 014 charges model and tool calls only.
DROP FUNCTION IF EXISTS osirus.checkpoint_stage_budget(
  uuid, uuid, uuid, text, jsonb, integer, integer
);

CREATE OR REPLACE FUNCTION osirus.checkpoint_stage_budget(
  p_run_id uuid,
  p_stage_id uuid,
  p_attempt_id uuid,
  p_label text,
  p_state jsonb,
  p_model_calls integer,
  p_tool_calls integer,
  p_attempts integer DEFAULT 0
)
RETURNS TABLE (
  version integer,
  exhausted boolean,
  reason text,
  charged_model_calls integer,
  charged_tool_calls integer,
  charged_attempts integer
)
LANGUAGE plpgsql
AS $function$
DECLARE
  v_model integer;
  v_tool integer;
  v_attempts integer;
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
    RETURN QUERY SELECT COALESCE(v_version, 0), false, NULL::text, 0, 0, 0;
    RETURN;
  END IF;

  v_model := GREATEST(COALESCE(p_model_calls, 0), 0);
  v_tool := GREATEST(COALESCE(p_tool_calls, 0), 0);
  v_attempts := GREATEST(COALESCE(p_attempts, 0), 0);

  INSERT INTO osirus.stage_budget_settlements (
    attempt_id, run_id, stage_id, model_calls, tool_calls, attempts
  )
  VALUES (p_attempt_id, p_run_id, p_stage_id, v_model, v_tool, v_attempts);

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
      'toolCalls', v_tool,
      'attempts', v_attempts
    )
  );

  v_checkpoint := osirus.save_run_checkpoint(
    p_run_id, p_stage_id, p_label, v_state
  );

  IF v_model > 0 OR v_tool > 0 OR v_attempts > 0 THEN
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
        v_attempts,
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
           v_tool,
           v_attempts;
END;
$function$;
