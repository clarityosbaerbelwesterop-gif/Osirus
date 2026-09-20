-- Production durability additions for M1-M5 certification.
ALTER TABLE osirus.runs
  ADD COLUMN IF NOT EXISTS request_id text;

CREATE UNIQUE INDEX IF NOT EXISTS runs_workspace_request_id_unique
  ON osirus.runs (workspace_id, request_id)
  WHERE request_id IS NOT NULL;

ALTER TABLE osirus.runs DROP CONSTRAINT IF EXISTS runs_status_check;
ALTER TABLE osirus.runs
  ADD CONSTRAINT runs_status_check CHECK (
    status = ANY (
      ARRAY[
        'created'::text,
        'planning'::text,
        'queued'::text,
        'running'::text,
        'waiting_for_approval'::text,
        'verifying'::text,
        'repairing'::text,
        'blocked'::text,
        'cancelling'::text,
        'cancelled'::text,
        'failed'::text,
        'completed'::text
      ]
    )
  );

ALTER TABLE osirus.run_stages DROP CONSTRAINT IF EXISTS run_stages_status_check;
ALTER TABLE osirus.run_stages
  ADD CONSTRAINT run_stages_status_check CHECK (
    status = ANY (
      ARRAY[
        'pending'::text,
        'running'::text,
        'waiting'::text,
        'blocked'::text,
        'failed'::text,
        'completed'::text,
        'skipped'::text,
        'cancelled'::text
      ]
    )
  );

DROP INDEX IF EXISTS osirus.runs_active_idx;
CREATE INDEX runs_active_idx
  ON osirus.runs (workspace_id, status, updated_at DESC)
  WHERE status = ANY (
    ARRAY[
      'created'::text,
      'planning'::text,
      'queued'::text,
      'running'::text,
      'waiting_for_approval'::text,
      'verifying'::text,
      'repairing'::text,
      'blocked'::text,
      'cancelling'::text
    ]
  );

ALTER TABLE osirus.run_events
  ADD COLUMN IF NOT EXISTS parent_event_id uuid,
  ADD COLUMN IF NOT EXISTS correlation_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'run_events_parent_event_id_fkey'
       AND conrelid = 'osirus.run_events'::regclass
  ) THEN
    ALTER TABLE osirus.run_events
      ADD CONSTRAINT run_events_parent_event_id_fkey
      FOREIGN KEY (parent_event_id)
      REFERENCES osirus.run_events(id)
      ON DELETE SET NULL;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS run_events_correlation_idx
  ON osirus.run_events (run_id, correlation_id, sequence);

CREATE INDEX IF NOT EXISTS memory_items_search_tsv_idx
  ON osirus.memory_items
  USING gin (to_tsvector('simple', searchable_text));

CREATE OR REPLACE FUNCTION osirus.append_run_event(
  p_run_id uuid,
  p_stage_id uuid,
  p_type text,
  p_visibility text,
  p_summary text,
  p_data jsonb DEFAULT '{}'::jsonb,
  p_parent_event_id uuid DEFAULT NULL,
  p_correlation_id uuid DEFAULT NULL
)
RETURNS osirus.run_events
LANGUAGE plpgsql
AS $function$
DECLARE
  next_sequence bigint;
  inserted osirus.run_events;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_run_id::text, 0));

  SELECT COALESCE(MAX(sequence), 0) + 1
    INTO next_sequence
    FROM osirus.run_events
   WHERE run_id = p_run_id;

  INSERT INTO osirus.run_events (
    run_id,
    stage_id,
    sequence,
    type,
    visibility,
    summary,
    data,
    parent_event_id,
    correlation_id
  )
  VALUES (
    p_run_id,
    p_stage_id,
    next_sequence,
    p_type,
    p_visibility,
    p_summary,
    COALESCE(p_data, '{}'::jsonb),
    p_parent_event_id,
    p_correlation_id
  )
  RETURNING * INTO inserted;

  RETURN inserted;
END;
$function$;

CREATE OR REPLACE FUNCTION osirus.save_run_checkpoint(
  p_run_id uuid,
  p_stage_id uuid,
  p_label text,
  p_state jsonb
)
RETURNS osirus.checkpoints
LANGUAGE plpgsql
AS $function$
DECLARE
  next_version integer;
  inserted osirus.checkpoints;
BEGIN
  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_run_id::text || ':checkpoint', 0)
  );

  SELECT COALESCE(MAX(version), 0) + 1
    INTO next_version
    FROM osirus.checkpoints
   WHERE run_id = p_run_id;

  INSERT INTO osirus.checkpoints (
    run_id,
    stage_id,
    label,
    state,
    version
  )
  VALUES (
    p_run_id,
    p_stage_id,
    p_label,
    p_state,
    next_version
  )
  RETURNING * INTO inserted;

  RETURN inserted;
END;
$function$;
