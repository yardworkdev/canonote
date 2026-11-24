-- Corrective migration for projects where early migrations were marked applied
-- but the live schema still lacks required tables/columns.

CREATE TABLE IF NOT EXISTS subscriptions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  status TEXT NOT NULL DEFAULT 'inactive',
  plan TEXT DEFAULT 'free',
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  cancel_at_period_end BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS subscriptions_user_id_idx ON subscriptions(user_id);
CREATE INDEX IF NOT EXISTS subscriptions_stripe_customer_id_idx ON subscriptions(stripe_customer_id);
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'subscriptions'
      AND policyname = 'Users can view their own subscription'
  ) THEN
    CREATE POLICY "Users can view their own subscription" ON subscriptions
      FOR SELECT
      USING (auth.uid() = user_id);
  END IF;
END
$$;

ALTER TABLE IF EXISTS notes ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE IF EXISTS notes ADD COLUMN IF NOT EXISTS note_id TEXT;
ALTER TABLE IF EXISTS notes ADD COLUMN IF NOT EXISTS title TEXT;
ALTER TABLE IF EXISTS notes ADD COLUMN IF NOT EXISTS content TEXT;
ALTER TABLE IF EXISTS notes ADD COLUMN IF NOT EXISTS is_pinned BOOLEAN DEFAULT FALSE;
ALTER TABLE IF EXISTS notes ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE IF EXISTS notes ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE IF EXISTS notes ADD COLUMN IF NOT EXISTS folder TEXT DEFAULT 'private';
ALTER TABLE IF EXISTS notes ADD COLUMN IF NOT EXISTS created_by TEXT DEFAULT 'user';
ALTER TABLE IF EXISTS notes ADD COLUMN IF NOT EXISTS created_by_name TEXT;
ALTER TABLE IF EXISTS notes ADD COLUMN IF NOT EXISTS updated_by TEXT;
ALTER TABLE IF EXISTS notes ADD COLUMN IF NOT EXISTS updated_by_name TEXT;

UPDATE notes
SET note_id = COALESCE(note_id, id::text)
WHERE note_id IS NULL;

CREATE INDEX IF NOT EXISTS notes_user_id_idx ON notes(user_id);
CREATE INDEX IF NOT EXISTS notes_updated_at_idx ON notes(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_notes_folder ON notes(folder);
CREATE INDEX IF NOT EXISTS idx_notes_created_by ON notes(created_by);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'notes_user_id_note_id_key'
  ) THEN
    ALTER TABLE notes
      ADD CONSTRAINT notes_user_id_note_id_key UNIQUE (user_id, note_id);
  END IF;
EXCEPTION
  WHEN duplicate_table OR duplicate_object THEN
    NULL;
END
$$;

ALTER TABLE notes ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'notes'
      AND policyname = 'Users can CRUD their own notes'
  ) THEN
    CREATE POLICY "Users can CRUD their own notes" ON notes
      FOR ALL
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;
END
$$;
