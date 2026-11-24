-- Hardening for delegated agent connections and revision-aware suggestions

ALTER TABLE IF EXISTS suggestions
  ADD COLUMN IF NOT EXISTS base_revision TEXT;

CREATE TABLE IF NOT EXISTS agent_connection_events (
  event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id UUID REFERENCES agent_connections(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_connection_events_connection_id ON agent_connection_events(connection_id);
CREATE INDEX IF NOT EXISTS idx_agent_connection_events_user_id ON agent_connection_events(user_id);
CREATE INDEX IF NOT EXISTS idx_agent_connection_events_created_at ON agent_connection_events(created_at DESC);

ALTER TABLE agent_connection_events ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'agent_connection_events'
      AND policyname = 'Users can view their own connection events'
  ) THEN
    CREATE POLICY "Users can view their own connection events"
      ON agent_connection_events FOR SELECT
      USING (auth.uid() = user_id);
  END IF;
END
$$;
