-- When a person finished or skipped the introduction tour. NULL: the tour
-- opens on their next visit to the app; it is shown once per account and can
-- be replayed from the settings without changing this value.
ALTER TABLE osirus.users
  ADD COLUMN IF NOT EXISTS onboarded_at timestamp with time zone;
