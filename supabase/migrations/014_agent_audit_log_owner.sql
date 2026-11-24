-- The audit trail is owned: an audit row names the user whose notes it covers.
--
-- `agent_audit_log` (005) carried the actor and the note key and nothing that
-- says whose notebook the event belongs to, so the only read it could support
-- was "every event from every user". The owner is what makes the trail
-- readable: `GET /api/agent/audit` filters on this column.
--
-- Rows written before this column existed have no owner and are not returned by
-- an owner-scoped read. Nothing has to be backfilled: the column is written by
-- `writeAuditEvent` from the authenticated actor's own `userId`.
ALTER TABLE agent_audit_log ADD COLUMN IF NOT EXISTS user_id TEXT;

CREATE INDEX IF NOT EXISTS idx_agent_audit_user_created
  ON agent_audit_log(user_id, created_at DESC);
