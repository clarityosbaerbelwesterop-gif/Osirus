CREATE TABLE osirus.request_rate_limits (
  subject text NOT NULL,
  route text NOT NULL,
  window_started_at timestamp with time zone NOT NULL,
  request_count integer NOT NULL DEFAULT 1,
  PRIMARY KEY (subject, route, window_started_at),
  CONSTRAINT request_rate_limits_count_check CHECK (request_count > 0)
);

ALTER TABLE osirus.request_rate_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE osirus.request_rate_limits FORCE ROW LEVEL SECURITY;

CREATE POLICY request_rate_limits_system_only ON osirus.request_rate_limits
  AS PERMISSIVE FOR ALL TO public
  USING (osirus.is_system())
  WITH CHECK (osirus.is_system());

CREATE INDEX request_rate_limits_window_idx
  ON osirus.request_rate_limits (window_started_at);
