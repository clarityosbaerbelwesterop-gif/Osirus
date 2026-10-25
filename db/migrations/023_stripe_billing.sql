-- Stripe billing columns for workspaces
ALTER TABLE osirus.workspaces
  ADD COLUMN IF NOT EXISTS stripe_customer_id text,
  ADD COLUMN IF NOT EXISTS stripe_subscription_id text,
  ADD COLUMN IF NOT EXISTS stripe_plan text,
  ADD COLUMN IF NOT EXISTS stripe_status text,
  ADD COLUMN IF NOT EXISTS stripe_current_period_end timestamp with time zone,
  ADD COLUMN IF NOT EXISTS stripe_cancel_at_period_end boolean DEFAULT false;

CREATE INDEX IF NOT EXISTS workspaces_stripe_customer_id_idx
  ON osirus.workspaces (stripe_customer_id);
CREATE INDEX IF NOT EXISTS workspaces_stripe_subscription_id_idx
  ON osirus.workspaces (stripe_subscription_id);