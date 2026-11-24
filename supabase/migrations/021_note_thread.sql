-- 021: the shared thread on a note.
--
-- Presence is a heartbeat in memory: it answers "who is in this note now" and it
-- is supposed to forget. A thread is the other shape — a message outlives a
-- redeploy, a closed tab and a night's sleep, so it is a table.
--
-- Why this exists at all: the notebook's promise is that an agent cannot change
-- your text silently. Until now that promise rested on the agent choosing to be
-- polite. With this table an agent has somewhere to put a proposed change instead
-- of putting it in the note, the person applies it or does not, and applying is a
-- normal guarded save. The refusal stops being a matter of the agent's manners.
--
-- Rows are scoped to (user_id, note_id) and nothing else: the same note id under
-- a different owner is a different thread, so a leaked id discloses nothing.
CREATE TABLE IF NOT EXISTS note_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  note_id TEXT NOT NULL,
  -- 'human' or 'agent'. An agent's words are never attributed to the person; the
  -- editor renders by this column, not by what the body claims.
  author_type TEXT NOT NULL CHECK (author_type IN ('human', 'agent')),
  author_name TEXT NOT NULL DEFAULT '',
  -- 'note' is conversation, 'proposal' is text offered for the note, 'decision'
  -- is the person's answer. A decision is a message too, so the trail reads in
  -- one column and nothing has to be joined to explain what happened.
  kind TEXT NOT NULL DEFAULT 'note' CHECK (kind IN ('note', 'proposal', 'decision')),
  body TEXT NOT NULL,
  -- The revision a proposal was written against. Null for conversation. Used to
  -- say plainly "this was written for a version you have since changed" instead
  -- of offering text that no longer fits.
  base_revision INTEGER,
  decision TEXT CHECK (decision IN ('applied', 'dismissed')),
  applied_at TIMESTAMPTZ,
  decided_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- A proposal must name its revision; nothing else may.
  CONSTRAINT note_messages_proposal_has_base
    CHECK ((kind = 'proposal') = (base_revision IS NOT NULL))
);

-- The poll: "everything on this note after T", oldest first. One index, because
-- this is the only read that happens while a person is watching the note.
CREATE INDEX IF NOT EXISTS note_messages_poll_idx
  ON note_messages (user_id, note_id, created_at);

ALTER TABLE note_messages ENABLE ROW LEVEL SECURITY;

-- The browser reads the thread directly for its own notes only. It never writes:
-- a message is posted through the API, which applies the byte cap, the kind check
-- and the note's agent switch. RLS decides whose rows, not what a row may contain,
-- and migration 020 exists because that distinction was learned the hard way.
DROP POLICY IF EXISTS "Users can read their own note messages" ON note_messages;
CREATE POLICY "Users can read their own note messages" ON note_messages
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

REVOKE INSERT, UPDATE, DELETE ON public.note_messages FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.note_messages FROM anon;
