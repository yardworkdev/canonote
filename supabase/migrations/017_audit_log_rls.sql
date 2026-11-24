-- 017 — the audit trail is not public
--
-- `agent_audit_log` was created without row level security, so the anon key that
-- ships in the browser bundle could read it straight from PostgREST:
--
--   GET /rest/v1/agent_audit_log?select=*     → 200, every row
--
-- Rows carry note_key, the actor, and metadata with the note's title and folder.
-- No bodies, but enough to enumerate what exists and what agents did, which is
-- exactly what the "an agent cannot see what it was not given" rule forbids.
--
-- With RLS on and no policies, anon and authenticated roles get nothing; the
-- server's service key bypasses RLS, and every read goes through
-- GET /api/agent/audit, which already checks the token and the note's switch.

ALTER TABLE agent_audit_log ENABLE ROW LEVEL SECURITY;
