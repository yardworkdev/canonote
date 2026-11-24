-- 020: connection rows were writable straight from the browser.
--
-- Migration 006 let `authenticated` INSERT into agent_connections under an
-- RLS policy. RLS decides *whose* row, not *what* the row may contain, so a
-- signed-in person could post their own connection row directly with any
-- expires_at, any scopes and a token hash they chose — bypassing the TTL ceiling,
-- the active-connection cap and the scope allowlist, all of which live only in
-- the handler. Creation already goes through the service-role route, which
-- applies those rules, so the direct grant is removed.

REVOKE INSERT, UPDATE, DELETE ON public.agent_connections FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.agent_connections FROM anon;

-- The owner may still read their own rows (the app shows the list only through
-- the API, but a direct read must not widen when a write is taken away).
DROP POLICY IF EXISTS "Users can manage their own agent connections" ON agent_connections;
DROP POLICY IF EXISTS "Users can read their own agent connections" ON agent_connections;
CREATE POLICY "Users can read their own agent connections" ON agent_connections
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
