-- 016 — the agent folder the code already writes to
--
-- `createNote` in api/_lib/agent-handler.js has always defaulted an agent's note
-- to folder 'agent' (AGENT_FOLDER in agent-identity.js), but the check constraint
-- from migration 003 only allows 'private', 'shared' and 'rudi'. Every
-- POST /api/agent/notes therefore failed with a 500 and a raw Postgres error, so
-- agents could read and patch notes but never create one.
--
-- Widening the constraint is the fix that keeps the intent: an agent's note is
-- still grouped separately from the person's private notes.

ALTER TABLE notes DROP CONSTRAINT IF EXISTS notes_folder_check;
ALTER TABLE notes ADD CONSTRAINT notes_folder_check
  CHECK (folder IN ('private', 'shared', 'rudi', 'agent'));
