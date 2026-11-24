-- Make notes robust as the authoritative source of truth.
-- Safe to run multiple times.

ALTER TABLE IF EXISTS notes ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE IF EXISTS notes ADD COLUMN IF NOT EXISTS version BIGINT NOT NULL DEFAULT 1;
ALTER TABLE IF EXISTS notes ADD COLUMN IF NOT EXISTS is_pinned BOOLEAN DEFAULT FALSE;

UPDATE notes SET version = 1 WHERE version IS NULL;

CREATE INDEX IF NOT EXISTS notes_user_live_updated_idx
  ON notes(user_id, deleted_at, updated_at DESC);

CREATE INDEX IF NOT EXISTS notes_user_note_id_idx
  ON notes(user_id, note_id);

CREATE OR REPLACE FUNCTION update_notes_authoritative_columns()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  NEW.version = COALESCE(OLD.version, 0) + 1;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_notes_authoritative_columns_trigger ON notes;
CREATE TRIGGER update_notes_authoritative_columns_trigger
BEFORE UPDATE ON notes
FOR EACH ROW
EXECUTE FUNCTION update_notes_authoritative_columns();

ALTER TABLE notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can CRUD their own notes" ON notes;
DROP POLICY IF EXISTS "Users can select their own notes" ON notes;
DROP POLICY IF EXISTS "Users can insert their own notes" ON notes;
DROP POLICY IF EXISTS "Users can update their own notes" ON notes;
DROP POLICY IF EXISTS "Users can delete their own notes" ON notes;

CREATE POLICY "Users can select their own notes" ON notes
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own notes" ON notes
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own notes" ON notes
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own notes" ON notes
  FOR DELETE
  USING (auth.uid() = user_id);
