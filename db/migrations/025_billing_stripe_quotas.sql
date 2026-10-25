-- Billing: Stripe customers and subscriptions per user, and the processed
-- Stripe webhook events (idempotency). Usage quotas are computed from the
-- existing osirus.model_calls.estimated_cost_usd, attributed to the run's
-- requested_by user, so no usage table is needed.
--
-- Rows are written only by the Stripe webhook (a system caller). A user may
-- read their own customer and subscription rows.

CREATE TABLE IF NOT EXISTS osirus.billing_customers (
  user_id uuid NOT NULL,
  stripe_customer_id text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id),
  CONSTRAINT billing_customers_stripe_customer_id_key UNIQUE (stripe_customer_id),
  CONSTRAINT billing_customers_user_id_fkey FOREIGN KEY (user_id) REFERENCES osirus.users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS osirus.billing_subscriptions (
  stripe_subscription_id text NOT NULL,
  user_id uuid NOT NULL,
  stripe_customer_id text NOT NULL,
  plan text,
  price_id text,
  status text NOT NULL,
  current_period_end timestamp with time zone,
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  -- created timestamp of the Stripe event that last wrote this row; an older
  -- event arriving late never overwrites a newer state.
  stripe_event_created timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (stripe_subscription_id),
  CONSTRAINT billing_subscriptions_plan_check CHECK (plan IS NULL OR plan = ANY (ARRAY['pro'::text, 'developer'::text, 'ultra_100'::text, 'ultra_200'::text])),
  CONSTRAINT billing_subscriptions_user_id_fkey FOREIGN KEY (user_id) REFERENCES osirus.users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS billing_subscriptions_user_idx
  ON osirus.billing_subscriptions (user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS osirus.stripe_events (
  id text NOT NULL,
  type text NOT NULL,
  received_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);

-- Quota reads: a user's model calls in the last 7 days.
CREATE INDEX IF NOT EXISTS runs_requested_by_idx
  ON osirus.runs (requested_by);
CREATE INDEX IF NOT EXISTS model_calls_created_idx
  ON osirus.model_calls (created_at DESC);

-- Row-level security.

ALTER TABLE osirus.billing_customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE osirus.billing_customers FORCE ROW LEVEL SECURITY;
CREATE POLICY billing_customers_read ON osirus.billing_customers
  AS PERMISSIVE FOR SELECT TO public
  USING (osirus.is_system() OR user_id = osirus.current_user_id());
CREATE POLICY billing_customers_write ON osirus.billing_customers
  AS PERMISSIVE FOR ALL TO public
  USING (osirus.is_system())
  WITH CHECK (osirus.is_system());

ALTER TABLE osirus.billing_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE osirus.billing_subscriptions FORCE ROW LEVEL SECURITY;
CREATE POLICY billing_subscriptions_read ON osirus.billing_subscriptions
  AS PERMISSIVE FOR SELECT TO public
  USING (osirus.is_system() OR user_id = osirus.current_user_id());
CREATE POLICY billing_subscriptions_write ON osirus.billing_subscriptions
  AS PERMISSIVE FOR ALL TO public
  USING (osirus.is_system())
  WITH CHECK (osirus.is_system());

ALTER TABLE osirus.stripe_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE osirus.stripe_events FORCE ROW LEVEL SECURITY;
CREATE POLICY stripe_events_system_only ON osirus.stripe_events
  AS PERMISSIVE FOR ALL TO public
  USING (osirus.is_system())
  WITH CHECK (osirus.is_system());

GRANT SELECT, INSERT, UPDATE ON osirus.billing_customers TO osirus_app;
GRANT SELECT, INSERT, UPDATE ON osirus.billing_subscriptions TO osirus_app;
GRANT SELECT, INSERT, DELETE ON osirus.stripe_events TO osirus_app;

-- Default privileges from 007 also grant every table verb. No code path
-- deletes a customer or subscription row (a deleted user's rows go by
-- ON DELETE CASCADE, which runs as the table owner), and an event claim is
-- only inserted or released, never updated. TRUNCATE, REFERENCES and TRIGGER
-- are never needed by the app; they are revoked explicitly so a future
-- default-privilege change cannot hand them out.
REVOKE DELETE, TRUNCATE, REFERENCES, TRIGGER ON osirus.billing_customers FROM osirus_app;
REVOKE DELETE, TRUNCATE, REFERENCES, TRIGGER ON osirus.billing_subscriptions FROM osirus_app;
REVOKE UPDATE, TRUNCATE, REFERENCES, TRIGGER ON osirus.stripe_events FROM osirus_app;
