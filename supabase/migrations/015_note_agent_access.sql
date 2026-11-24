-- Per-note agent access.
--
-- The global switch decides whether an agent can enter the notebook at all. This
-- column decides, note by note, whether it can see one. A note with the flag false
-- is absent from agent lists, search and single-note reads, and answers 404 rather
-- than 403, so an agent cannot enumerate what it is not allowed to see.
--
-- Default true: every existing note keeps behaving exactly as it does today until
-- its owner turns the switch off. Only `PATCH /api/notes/:noteId` (Supabase user JWT)
-- can change it; no agent route can set `agent_access`.
ALTER TABLE IF EXISTS notes ADD COLUMN IF NOT EXISTS agent_access BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN notes.agent_access IS
  'False hides this note from every agent route (404, not 403). Owner-controlled via PATCH /api/notes/:id.';

-- The agent list query filters on this column, so index only the rows it keeps.
CREATE INDEX IF NOT EXISTS idx_notes_agent_access
  ON notes (user_id, updated_at DESC)
  WHERE agent_access = TRUE AND deleted_at IS NULL;
