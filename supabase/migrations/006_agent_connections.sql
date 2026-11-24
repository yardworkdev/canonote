-- Delegated agent connections for authenticated human-agent workspaces

CREATE TABLE IF NOT EXISTS agent_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  agent_id TEXT NOT NULL DEFAULT 'agent_rudi',
  agent_label TEXT NOT NULL DEFAULT 'Rudi',
  token_hash TEXT NOT NULL UNIQUE,
  token_prefix TEXT NOT NULL,
  scopes TEXT[] NOT NULL DEFAULT ARRAY['notes:read', 'notes:write', 'collab:read', 'collab:write'],
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  last_used_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_connections_user_id ON agent_connections(user_id);
CREATE INDEX IF NOT EXISTS idx_agent_connections_active ON agent_connections(is_active) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_agent_connections_agent_id ON agent_connections(agent_id);

ALTER TABLE agent_connections ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'agent_connections'
      AND policyname = 'Users can view their own agent connections'
  ) THEN
    CREATE POLICY "Users can view their own agent connections"
      ON agent_connections FOR SELECT
      USING (auth.uid() = user_id);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'agent_connections'
      AND policyname = 'Users can create their own agent connections'
  ) THEN
    CREATE POLICY "Users can create their own agent connections"
      ON agent_connections FOR INSERT
      WITH CHECK (auth.uid() = user_id);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'agent_connections'
      AND policyname = 'Users can update their own agent connections'
  ) THEN
    CREATE POLICY "Users can update their own agent connections"
      ON agent_connections FOR UPDATE
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'agent_connections'
      AND policyname = 'Users can delete their own agent connections'
  ) THEN
    CREATE POLICY "Users can delete their own agent connections"
      ON agent_connections FOR DELETE
      USING (auth.uid() = user_id);
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION update_agent_connections_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_agent_connections_updated_at_trigger ON agent_connections;
CREATE TRIGGER update_agent_connections_updated_at_trigger
BEFORE UPDATE ON agent_connections
FOR EACH ROW
EXECUTE FUNCTION update_agent_connections_updated_at();
