-- A chat answer belongs to the person whether or not the page is still
-- open: Safari in the background drops the connection, and an answer cut
-- off there was charged and lost (reported 2026-11-25). The answer now runs
-- to its end after a dropped connection; only the stop button ends it. The
-- button records its wish here first, so the instance that writes the
-- answer sees it whichever instance took the click.
ALTER TABLE osirus.sessions
  ADD COLUMN IF NOT EXISTS stop_requested_at timestamp with time zone;
