-- canonote: the three migrations the live database is missing.
--
-- Safe to run more than once: every statement is IF NOT EXISTS. Paste the whole
-- thing into Supabase → SQL Editor → Run, then tell Promi.
--
-- Why each one is here:
--   005  agent_audit_log          every agent write leaves a row; without the
--                                 table an agent write answers 500 after writing
--   007  agent_connection_events  one row per token issue/revoke
--   014  agent_audit_log.user_id  owner-scoped reads of the trail
--   015  notes.agent_access       the per-note switch; without the column the
--                                 notes API itself fails, not just the agent

-- 005 ------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS agent_audit_log (
  event_id UUID PRIMARY KEY,
  note_key TEXT,
  actor_id TEXT NOT NULL,
  actor_type TEXT NOT NULL,
  action TEXT NOT NULL,
  before_hash TEXT,
  after_hash TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_agent_audit_note_key ON agent_audit_log(note_key);
CREATE INDEX IF NOT EXISTS idx_agent_audit_created_at ON agent_audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_audit_actor_id ON agent_audit_log(actor_id);

-- 007 ------------------------------------------------------------------------
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

-- 014 ------------------------------------------------------------------------
ALTER TABLE agent_audit_log ADD COLUMN IF NOT EXISTS user_id TEXT;
CREATE INDEX IF NOT EXISTS idx_agent_audit_user_created
  ON agent_audit_log(user_id, created_at DESC);

-- 015 ------------------------------------------------------------------------
ALTER TABLE IF EXISTS notes ADD COLUMN IF NOT EXISTS agent_access BOOLEAN NOT NULL DEFAULT TRUE;

-- What this should print when it worked.
SELECT
  to_regclass('public.agent_audit_log')        AS audit_table,
  to_regclass('public.agent_connection_events') AS connection_events,
  (SELECT count(*) FROM information_schema.columns
    WHERE table_name = 'notes' AND column_name = 'agent_access') AS agent_access_column,
  (SELECT count(*) FROM information_schema.columns
    WHERE table_name = 'agent_audit_log' AND column_name = 'user_id') AS audit_owner_column;
