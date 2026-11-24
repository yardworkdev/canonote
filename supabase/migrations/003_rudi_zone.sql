-- Database schema for Rudi Zone collaboration

-- Add new columns to notes table
ALTER TABLE IF EXISTS notes ADD COLUMN IF NOT EXISTS folder TEXT DEFAULT 'private' CHECK (folder IN ('private', 'shared', 'rudi'));
ALTER TABLE IF EXISTS notes ADD COLUMN IF NOT EXISTS created_by TEXT DEFAULT 'user';
ALTER TABLE IF EXISTS notes ADD COLUMN IF NOT EXISTS created_by_name TEXT;
ALTER TABLE IF EXISTS notes ADD COLUMN IF NOT EXISTS updated_by TEXT;
ALTER TABLE IF EXISTS notes ADD COLUMN IF NOT EXISTS updated_by_name TEXT;

CREATE INDEX IF NOT EXISTS idx_notes_folder ON notes(folder);
CREATE INDEX IF NOT EXISTS idx_notes_created_by ON notes(created_by);

-- Note permissions table
CREATE TABLE IF NOT EXISTS note_permissions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  note_id UUID REFERENCES notes(id) ON DELETE CASCADE,
  agent_id TEXT NOT NULL,
  level TEXT NOT NULL CHECK (level IN ('view', 'comment', 'edit')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(note_id, agent_id)
);

ALTER TABLE note_permissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view permissions for their notes"
  ON note_permissions FOR SELECT
  USING (EXISTS (SELECT 1 FROM notes WHERE notes.id = note_permissions.note_id AND notes.user_id = auth.uid()));

CREATE POLICY "Users can manage permissions for their notes"
  ON note_permissions FOR ALL
  USING (EXISTS (SELECT 1 FROM notes WHERE notes.id = note_permissions.note_id AND notes.user_id = auth.uid()));

-- Suggestions table
CREATE TABLE IF NOT EXISTS suggestions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  note_id UUID REFERENCES notes(id) ON DELETE CASCADE,
  agent_id TEXT NOT NULL,
  agent_name TEXT,
  content_changes TEXT,
  title_change TEXT,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  resolved_at TIMESTAMP WITH TIME ZONE
);

ALTER TABLE suggestions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view suggestions for their notes"
  ON suggestions FOR SELECT
  USING (EXISTS (SELECT 1 FROM notes WHERE notes.id = suggestions.note_id AND notes.user_id = auth.uid()));

CREATE POLICY "Users can manage suggestions for their notes"
  ON suggestions FOR ALL
  USING (EXISTS (SELECT 1 FROM notes WHERE notes.id = suggestions.note_id AND notes.user_id = auth.uid()));

-- Comments table
CREATE TABLE IF NOT EXISTS comments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  note_id UUID REFERENCES notes(id) ON DELETE CASCADE,
  author TEXT NOT NULL,
  author_name TEXT,
  content TEXT NOT NULL,
  selection JSONB,
  parent_id UUID REFERENCES comments(id) ON DELETE CASCADE,
  resolved BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE comments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view comments on their notes"
  ON comments FOR SELECT
  USING (EXISTS (SELECT 1 FROM notes WHERE notes.id = comments.note_id AND notes.user_id = auth.uid()));

CREATE POLICY "Users can manage comments on their notes"
  ON comments FOR ALL
  USING (EXISTS (SELECT 1 FROM notes WHERE notes.id = comments.note_id AND notes.user_id = auth.uid()));

-- Activity log table
CREATE TABLE IF NOT EXISTS activity_log (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  note_id UUID REFERENCES notes(id) ON DELETE CASCADE,
  actor TEXT NOT NULL,
  actor_name TEXT,
  action TEXT NOT NULL,
  details JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE activity_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view activity for their notes"
  ON activity_log FOR SELECT
  USING (EXISTS (SELECT 1 FROM notes WHERE notes.id = activity_log.note_id AND notes.user_id = auth.uid()));

-- Indexes
CREATE INDEX IF NOT EXISTS idx_permissions_note ON note_permissions(note_id);
CREATE INDEX IF NOT EXISTS idx_permissions_agent ON note_permissions(agent_id);
CREATE INDEX IF NOT EXISTS idx_suggestions_note ON suggestions(note_id);
CREATE INDEX IF NOT EXISTS idx_suggestions_status ON suggestions(status);
CREATE INDEX IF NOT EXISTS idx_comments_note ON comments(note_id);
CREATE INDEX IF NOT EXISTS idx_comments_resolved ON comments(resolved);
CREATE INDEX IF NOT EXISTS idx_activity_note ON activity_log(note_id);
CREATE INDEX IF NOT EXISTS idx_activity_actor ON activity_log(actor);
CREATE INDEX IF NOT EXISTS idx_activity_created ON activity_log(created_at DESC);
