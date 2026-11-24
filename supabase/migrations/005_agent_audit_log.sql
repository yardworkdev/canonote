-- Immutable audit log for agent note mutations
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
