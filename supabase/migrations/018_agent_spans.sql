-- 018: which characters of a note an agent wrote.

-- The notebook's differentiator is that a person can tell their own words from
-- an agent's at a glance. The editor draws a background behind the agent's text,
-- and that needs the ranges stored with the text itself: a separate table would
-- have to be kept in step with every edit by both writers, and would drift.
--
-- Spans are character offsets into `content`, as [{"start": 12, "end": 40}].
-- They are written by the notes service on every write: an agent's write adds its
-- region, a person's write only remaps the existing ones, so text either side
-- replaced stops being the agent's.
ALTER TABLE notes
  ADD COLUMN IF NOT EXISTS agent_spans jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN notes.agent_spans IS
  'Character ranges of content written by an agent, as [{"start","end"}]. Maintained on every write.';
