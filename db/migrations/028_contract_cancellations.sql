-- Cancellations declared through the public cancellation page (§ 312k BGB).
-- Each row is the declaration as it was received: who, which contract, which
-- kind, the requested end and the exact time of receipt, plus what Osirus did
-- with it (the subscription it was matched to, the end it set, whether the
-- confirmation went out). Rows are evidence and are never deleted by the app.
CREATE TABLE IF NOT EXISTS osirus.contract_cancellations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference text NOT NULL,
  received_at timestamp with time zone NOT NULL DEFAULT now(),
  name text NOT NULL,
  email text NOT NULL,
  contract text NOT NULL,
  customer_reference text,
  kind text NOT NULL,
  reason text,
  timing text NOT NULL,
  requested_end date,
  user_id uuid,
  signed_in boolean NOT NULL DEFAULT false,
  stripe_subscription_id text,
  effective_at timestamp with time zone,
  status text NOT NULL DEFAULT 'received',
  processing_note text,
  confirmation_sent_at timestamp with time zone,
  network_hash text,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT contract_cancellations_reference_key UNIQUE (reference),
  CONSTRAINT contract_cancellations_contract_check
    CHECK (contract = ANY (ARRAY['subscription'::text, 'free'::text])),
  CONSTRAINT contract_cancellations_kind_check
    CHECK (kind = ANY (ARRAY['ordinary'::text, 'extraordinary'::text])),
  CONSTRAINT contract_cancellations_timing_check
    CHECK (timing = ANY (ARRAY['earliest'::text, 'date'::text])),
  CONSTRAINT contract_cancellations_status_check
    CHECK (status = ANY (ARRAY[
      'received'::text, 'scheduled'::text, 'already_ending'::text,
      'unmatched'::text, 'manual'::text, 'failed'::text
    ])),
  CONSTRAINT contract_cancellations_reason_check
    CHECK (kind = 'ordinary' OR char_length(coalesce(reason, '')) > 0),
  CONSTRAINT contract_cancellations_date_check
    CHECK (timing = 'earliest' OR requested_end IS NOT NULL),
  CONSTRAINT contract_cancellations_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES osirus.users (id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS contract_cancellations_email_idx
  ON osirus.contract_cancellations (lower(email), received_at DESC);
CREATE INDEX IF NOT EXISTS contract_cancellations_user_idx
  ON osirus.contract_cancellations (user_id, received_at DESC);

ALTER TABLE osirus.contract_cancellations ENABLE ROW LEVEL SECURITY;
ALTER TABLE osirus.contract_cancellations FORCE ROW LEVEL SECURITY;

-- The page posts without an account, so only the server (system caller)
-- writes and reads; a signed-in person reads the declarations made for them.
CREATE POLICY contract_cancellations_read ON osirus.contract_cancellations
  AS PERMISSIVE FOR SELECT TO public
  USING (osirus.is_system() OR user_id = osirus.current_user_id());

CREATE POLICY contract_cancellations_write ON osirus.contract_cancellations
  AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (osirus.is_system());

CREATE POLICY contract_cancellations_update ON osirus.contract_cancellations
  AS PERMISSIVE FOR UPDATE TO public
  USING (osirus.is_system())
  WITH CHECK (osirus.is_system());

GRANT SELECT, INSERT, UPDATE ON osirus.contract_cancellations TO osirus_app;
REVOKE DELETE, TRUNCATE, REFERENCES, TRIGGER ON osirus.contract_cancellations FROM osirus_app;

-- The operator learns of every declaration in the inbox, so one that could
-- not be matched or processed automatically is handled by hand at once.
ALTER TABLE osirus.notifications DROP CONSTRAINT IF EXISTS notifications_kind_check;
ALTER TABLE osirus.notifications ADD CONSTRAINT notifications_kind_check
  CHECK (kind = ANY (ARRAY[
    'approval_needed'::text, 'automation_completed'::text,
    'automation_failed'::text, 'run_blocked'::text,
    'connector_expired'::text, 'cancellation_received'::text
  ]));
