-- Which product surface a conversation belongs to. Chat, agent, bot, and
-- coding do not share threads. Existing rows were runtime conversations, so
-- they stay on the agent surface rather than appearing in chat.

ALTER TABLE osirus.sessions
  ADD COLUMN IF NOT EXISTS surface text NOT NULL DEFAULT 'agent';

ALTER TABLE osirus.sessions
  DROP CONSTRAINT IF EXISTS sessions_surface_check;

ALTER TABLE osirus.sessions
  ADD CONSTRAINT sessions_surface_check
  CHECK (surface = ANY (ARRAY['ai'::text, 'agent'::text, 'bot'::text, 'coding'::text]));
