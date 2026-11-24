-- Smart Links Schema
CREATE TABLE IF NOT EXISTS smart_links (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  note_id UUID REFERENCES notes(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  permission TEXT NOT NULL CHECK (permission IN ('view', 'comment', 'edit')),
  expires_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE smart_links ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_smart_links_token ON smart_links(token);
CREATE INDEX IF NOT EXISTS idx_smart_links_note ON smart_links(note_id);
