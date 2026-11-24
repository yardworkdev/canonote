-- Hardening migration: add missing columns and fix schema gaps
-- Safe to run multiple times (all operations are IF NOT EXISTS / idempotent)

-- ============================================
-- NOTES TABLE: ensure all collaboration columns exist
-- ============================================

ALTER TABLE IF EXISTS notes ADD COLUMN IF NOT EXISTS note_id TEXT;
ALTER TABLE IF EXISTS notes ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE IF EXISTS notes ADD COLUMN IF NOT EXISTS title TEXT;
ALTER TABLE IF EXISTS notes ADD COLUMN IF NOT EXISTS content TEXT;
ALTER TABLE IF EXISTS notes ADD COLUMN IF NOT EXISTS created_by TEXT DEFAULT 'user';
ALTER TABLE IF EXISTS notes ADD COLUMN IF NOT EXISTS created_by_name TEXT;
ALTER TABLE IF EXISTS notes ADD COLUMN IF NOT EXISTS updated_by TEXT;
ALTER TABLE IF EXISTS notes ADD COLUMN IF NOT EXISTS updated_by_name TEXT;
ALTER TABLE IF EXISTS notes ADD COLUMN IF NOT EXISTS folder TEXT DEFAULT 'private';
ALTER TABLE IF EXISTS notes ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE IF EXISTS notes ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

-- Back-fill note_id for legacy rows where it was the primary key
UPDATE notes SET note_id = COALESCE(note_id, id::text) WHERE note_id IS NULL;

-- Ensure the unique constraint on (user_id, note_id) exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'notes_user_id_note_id_key'
      AND conrelid = 'notes'::regclass
  ) THEN
    -- Only add if there are no duplicates that would block it
    IF NOT EXISTS (
      SELECT note_id, user_id FROM notes
      WHERE note_id IS NOT NULL AND user_id IS NOT NULL
      GROUP BY note_id, user_id HAVING COUNT(*) > 1
    ) THEN
      ALTER TABLE notes ADD CONSTRAINT notes_user_id_note_id_key UNIQUE (user_id, note_id);
    END IF;
  END IF;
EXCEPTION WHEN OTHERS THEN
  NULL; -- Constraint already exists or can't be added safely
END
$$;

-- Indexes
CREATE INDEX IF NOT EXISTS notes_user_id_idx ON notes(user_id);
CREATE INDEX IF NOT EXISTS notes_note_id_idx ON notes(note_id);
CREATE INDEX IF NOT EXISTS notes_updated_at_idx ON notes(updated_at DESC);

-- ============================================
-- COMMENTS TABLE: add missing columns
-- ============================================

ALTER TABLE IF EXISTS comments ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ;
ALTER TABLE IF EXISTS comments ADD COLUMN IF NOT EXISTS author_id TEXT;
ALTER TABLE IF EXISTS comments ADD COLUMN IF NOT EXISTS author_name TEXT;
ALTER TABLE IF EXISTS comments ADD COLUMN IF NOT EXISTS text TEXT;

-- Back-fill author_id from author if missing
UPDATE comments SET author_id = COALESCE(author_id, author) WHERE author_id IS NULL;

-- ============================================
-- SUGGESTIONS TABLE: ensure required columns exist
-- ============================================

ALTER TABLE IF EXISTS suggestions ADD COLUMN IF NOT EXISTS base_revision TEXT;
ALTER TABLE IF EXISTS suggestions ADD COLUMN IF NOT EXISTS author_id TEXT;
ALTER TABLE IF EXISTS suggestions ADD COLUMN IF NOT EXISTS author_name TEXT;
ALTER TABLE IF EXISTS suggestions ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ;

-- Back-fill author_id from agent_id if missing
UPDATE suggestions SET author_id = COALESCE(author_id, agent_id) WHERE author_id IS NULL;
UPDATE suggestions SET author_name = COALESCE(author_name, agent_name) WHERE author_name IS NULL;

-- ============================================
-- ACTIVITY LOG TABLE: ensure required columns exist
-- ============================================

ALTER TABLE IF EXISTS activity_log ADD COLUMN IF NOT EXISTS actor_name TEXT;
ALTER TABLE IF EXISTS activity_log ADD COLUMN IF NOT EXISTS details JSONB DEFAULT '{}'::jsonb;
