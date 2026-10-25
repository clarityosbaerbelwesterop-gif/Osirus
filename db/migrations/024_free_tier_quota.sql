-- Free tier quota tracking
CREATE TABLE IF NOT EXISTS osirus.free_tier_quotas (
  workspace_id uuid NOT NULL REFERENCES osirus.workspaces(id) ON DELETE CASCADE,
  window_type text NOT NULL CHECK (window_type IN ('five_hour', 'weekly')),
  window_started_at timestamp with time zone NOT NULL,
  model_calls integer NOT NULL DEFAULT 0,
  input_tokens integer NOT NULL DEFAULT 0,
  output_tokens integer NOT NULL DEFAULT 0,
  estimated_cost_usd numeric(14,8) NOT NULL DEFAULT 0,
  PRIMARY KEY (workspace_id, window_type, window_started_at)
);

CREATE INDEX IF NOT EXISTS free_tier_quotas_workspace_window_idx
  ON osirus.free_tier_quotas (workspace_id, window_type, window_started_at DESC);

-- Default limits (can be overridden per workspace)
INSERT INTO osirus.entitlements (workspace_id, key, value, source)
SELECT id, 'free_tier_five_hour_calls', '50', 'default'
FROM osirus.workspaces
WHERE NOT EXISTS (
  SELECT 1 FROM osirus.entitlements e
  WHERE e.workspace_id = osirus.workspaces.id AND e.key = 'free_tier_five_hour_calls'
)
ON CONFLICT (workspace_id, key) DO NOTHING;

INSERT INTO osirus.entitlements (workspace_id, key, value, source)
SELECT id, 'free_tier_weekly_calls', '200', 'default'
FROM osirus.workspaces
WHERE NOT EXISTS (
  SELECT 1 FROM osirus.entitlements e
  WHERE e.workspace_id = osirus.workspaces.id AND e.key = 'free_tier_weekly_calls'
)
ON CONFLICT (workspace_id, key) DO NOTHING;