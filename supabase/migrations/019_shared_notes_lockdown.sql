-- 019: shared_notes was readable by anyone holding the public browser key.
--
-- Migration 002 created a SELECT policy with no TO clause:
--   CREATE POLICY "Anyone can read active shares" ON shared_notes
--     FOR SELECT USING (is_active = TRUE);
-- With no TO clause a policy applies to PUBLIC, which includes `anon`. The anon
-- key ships inside the browser bundle, so `GET /rest/v1/shared_notes?select=*`
-- returned every active share in the database: title, note_id, user_id,
-- share_token and the content snapshot. RLS cannot say "only with the token", so
-- the blanket read has to go; a public share, if it is ever built, must be
-- served by a route that looks the token up with the service key.
--
-- Nothing in the product reads this table today (no api/collaboration.js, no
-- client code). Dropping the policy costs nothing and closes the hole.

DROP POLICY IF EXISTS "Anyone can read active shares" ON shared_notes;

DROP POLICY IF EXISTS "Users can read their own shares" ON shared_notes;
CREATE POLICY "Users can read their own shares" ON shared_notes
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
