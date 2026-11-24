-- Notes Editor - AI Collaboration Schema
-- Share notes with AI agents and collaborators

-- ============================================
-- SHARED NOTES TABLE
-- Enables public/private sharing of notes via tokens
-- ============================================
CREATE TABLE IF NOT EXISTS shared_notes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  note_id TEXT NOT NULL,
  share_token TEXT UNIQUE NOT NULL,
  permissions TEXT DEFAULT 'read', -- 'read', 'write', 'comment'
  title TEXT,
  content_snapshot TEXT, -- Snapshot at time of sharing
  is_active BOOLEAN DEFAULT TRUE,
  view_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ, -- Optional expiration
  last_accessed_at TIMESTAMPTZ,
  
  UNIQUE(user_id, note_id, share_token)
);

-- Index for fast token lookups
CREATE INDEX IF NOT EXISTS shared_notes_token_idx ON shared_notes(share_token);
CREATE INDEX IF NOT EXISTS shared_notes_user_idx ON shared_notes(user_id);
CREATE INDEX IF NOT EXISTS shared_notes_active_idx ON shared_notes(is_active) WHERE is_active = TRUE;

-- Enable RLS
ALTER TABLE shared_notes ENABLE ROW LEVEL SECURITY;

-- RLS: Users can CRUD their own shares
CREATE POLICY "Users can manage their own shares" ON shared_notes
  FOR ALL 
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- RLS: Anyone can read active shares (for public sharing)
CREATE POLICY "Anyone can read active shares" ON shared_notes
  FOR SELECT
  USING (is_active = TRUE);

-- ============================================
-- NOTE COMMENTS TABLE
-- Comments on shared notes (from humans or AI)
-- ============================================
CREATE TABLE IF NOT EXISTS note_comments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  shared_note_id UUID REFERENCES shared_notes(id) ON DELETE CASCADE NOT NULL,
  parent_comment_id UUID REFERENCES note_comments(id) ON DELETE CASCADE, -- For threads
  
  -- Who made the comment
  author_type TEXT DEFAULT 'human', -- 'human', 'ai', 'system'
  author_name TEXT NOT NULL, -- 'Ves', 'Rudi', 'Claude', etc.
  author_id UUID REFERENCES auth.users(id), -- NULL for AI/external
  
  -- Comment content
  content TEXT NOT NULL,
  
  -- Context (for AI comments referencing specific parts)
  context_type TEXT, -- 'line', 'paragraph', 'section', 'general'
  context_range JSONB, -- { start: 100, end: 250 } for text ranges
  
  -- Status
  status TEXT DEFAULT 'pending', -- 'pending', 'approved', 'rejected', 'resolved'
  
  -- Metadata
  is_ai_generated BOOLEAN DEFAULT FALSE,
  ai_model TEXT, -- 'claude', 'gpt-4', etc.
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS note_comments_shared_note_idx ON note_comments(shared_note_id);
CREATE INDEX IF NOT EXISTS note_comments_author_idx ON note_comments(author_id);
CREATE INDEX IF NOT EXISTS note_comments_status_idx ON note_comments(status);

-- Enable RLS
ALTER TABLE note_comments ENABLE ROW LEVEL SECURITY;

-- RLS: Users can comment on shares they have access to
CREATE POLICY "Users can create comments" ON note_comments
  FOR INSERT
  WITH CHECK (
    -- Either the share owner
    EXISTS (
      SELECT 1 FROM shared_notes 
      WHERE shared_notes.id = note_comments.shared_note_id 
      AND shared_notes.user_id = auth.uid()
    )
    -- Or the share allows comments
    OR EXISTS (
      SELECT 1 FROM shared_notes 
      WHERE shared_notes.id = note_comments.shared_note_id 
      AND shared_notes.permissions IN ('comment', 'write')
    )
  );

-- RLS: Users can read comments on shares they have access to
CREATE POLICY "Users can read comments" ON note_comments
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM shared_notes 
      WHERE shared_notes.id = note_comments.shared_note_id
      AND (
        shared_notes.user_id = auth.uid()
        OR shared_notes.is_active = TRUE
      )
    )
  );

-- RLS: Users can update/delete their own comments
CREATE POLICY "Users can manage their own comments" ON note_comments
  FOR ALL
  USING (author_id = auth.uid())
  WITH CHECK (author_id = auth.uid());

-- ============================================
-- API KEYS TABLE
-- For AI agents and external tools
-- ============================================
CREATE TABLE IF NOT EXISTS api_keys (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  
  -- Key details
  key_hash TEXT NOT NULL, -- Hashed key for verification
  key_prefix TEXT, -- First 8 chars for identification
  
  -- Metadata
  name TEXT, -- e.g., "Rudi (AI Agent)", "Zapier Integration"
  description TEXT,
  
  -- Permissions
  permissions TEXT[] DEFAULT ARRAY['read'], -- 'read', 'write', 'comment', 'admin'
  
  -- Usage tracking
  last_used_at TIMESTAMPTZ,
  usage_count INTEGER DEFAULT 0,
  
  -- Status
  is_active BOOLEAN DEFAULT TRUE,
  expires_at TIMESTAMPTZ,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id) -- Who created this key
);

-- Indexes
CREATE INDEX IF NOT EXISTS api_keys_user_idx ON api_keys(user_id);
CREATE INDEX IF NOT EXISTS api_keys_active_idx ON api_keys(is_active);

-- Enable RLS
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;

-- RLS: Users can manage their own API keys
CREATE POLICY "Users can manage their own API keys" ON api_keys
  FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ============================================
-- ACTIVITY LOG TABLE
-- Track what happened on shared notes
-- ============================================
CREATE TABLE IF NOT EXISTS note_activity (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  shared_note_id UUID REFERENCES shared_notes(id) ON DELETE CASCADE,
  
  -- What happened
  action_type TEXT NOT NULL, -- 'viewed', 'commented', 'edited', 'shared', 'exported'
  action_details JSONB,
  
  -- Who did it
  actor_type TEXT DEFAULT 'human', -- 'human', 'ai', 'anonymous'
  actor_name TEXT,
  actor_id UUID REFERENCES auth.users(id),
  
  -- Metadata
  ip_address INET,
  user_agent TEXT,
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS note_activity_shared_note_idx ON note_activity(shared_note_id);
CREATE INDEX IF NOT EXISTS note_activity_created_idx ON note_activity(created_at DESC);

-- Enable RLS
ALTER TABLE note_activity ENABLE ROW LEVEL SECURITY;

-- RLS: Users can read activity on their shares
CREATE POLICY "Users can read activity on their shares" ON note_activity
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM shared_notes 
      WHERE shared_notes.id = note_activity.shared_note_id 
      AND shared_notes.user_id = auth.uid()
    )
  );

-- ============================================
-- TRIGGERS
-- ============================================

-- Auto-update updated_at on comments
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_note_comments_updated_at
BEFORE UPDATE ON note_comments
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- Increment view count on shared_notes access
CREATE OR REPLACE FUNCTION increment_share_view_count()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE shared_notes 
  SET view_count = view_count + 1,
      last_accessed_at = NOW()
  WHERE id = NEW.shared_note_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER log_share_view
AFTER INSERT ON note_activity
FOR EACH ROW
WHEN (NEW.action_type = 'viewed')
EXECUTE FUNCTION increment_share_view_count();

-- ============================================
-- HELPER FUNCTIONS
-- ============================================

-- Check if API key has permission
CREATE OR REPLACE FUNCTION api_key_has_permission(key_id UUID, required_permission TEXT)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM api_keys
    WHERE id = key_id
      AND is_active = TRUE
      AND (expires_at IS NULL OR expires_at > NOW())
      AND required_permission = ANY(permissions)
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Get share by token (for public access)
CREATE OR REPLACE FUNCTION get_share_by_token(token TEXT)
RETURNS TABLE (
  id UUID,
  note_id TEXT,
  user_id UUID,
  permissions TEXT,
  title TEXT,
  content_snapshot TEXT,
  is_active BOOLEAN
) AS $$
BEGIN
  RETURN QUERY
  SELECT s.id, s.note_id, s.user_id, s.permissions, s.title, s.content_snapshot, s.is_active
  FROM shared_notes s
  WHERE s.share_token = token
    AND s.is_active = TRUE
    AND (s.expires_at IS NULL OR s.expires_at > NOW());
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- ROW COUNT ESTIMATES FOR FREE TIER PLANNING
-- ============================================
-- shared_notes: ~100 rows per active user (generous)
-- note_comments: ~500 rows per active user
-- api_keys: ~5 rows per user
-- note_activity: ~1000 rows per user (rotated/deleted periodically)
-- 
-- Total per 1000 users: ~1.6M rows, ~500MB
-- Well within Supabase free tier limits (500MB database)
-- ============================================
