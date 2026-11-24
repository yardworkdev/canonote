-- Notes Editor - Initial Database Schema
-- Run this in Supabase SQL Editor or via migrations

-- ============================================
-- NOTES TABLE
-- Stores all user notes with content
-- ============================================
CREATE TABLE IF NOT EXISTS notes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  note_id TEXT NOT NULL,
  title TEXT,
  content TEXT,
  is_pinned BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Each user can only have one note with a given note_id
  UNIQUE(user_id, note_id)
);

-- Index for faster queries
CREATE INDEX IF NOT EXISTS notes_user_id_idx ON notes(user_id);
CREATE INDEX IF NOT EXISTS notes_updated_at_idx ON notes(updated_at DESC);

-- Enable Row Level Security
ALTER TABLE notes ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Users can only access their own notes
CREATE POLICY "Users can CRUD their own notes" ON notes
  FOR ALL 
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);


-- ============================================
-- SUBSCRIPTIONS TABLE
-- Tracks Stripe subscription status
-- ============================================
CREATE TABLE IF NOT EXISTS subscriptions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  status TEXT NOT NULL DEFAULT 'inactive', -- 'active', 'canceled', 'past_due', 'inactive'
  plan TEXT DEFAULT 'free', -- 'free', 'pro'
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  cancel_at_period_end BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for faster queries
CREATE INDEX IF NOT EXISTS subscriptions_user_id_idx ON subscriptions(user_id);
CREATE INDEX IF NOT EXISTS subscriptions_stripe_customer_id_idx ON subscriptions(stripe_customer_id);

-- Enable Row Level Security
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Users can only view their own subscription
CREATE POLICY "Users can view their own subscription" ON subscriptions
  FOR SELECT
  USING (auth.uid() = user_id);

-- Note: Subscription updates should only happen via Stripe webhooks (server-side)
-- No INSERT/UPDATE/DELETE policies for client-side


-- ============================================
-- NOTE VERSIONS TABLE (Optional)
-- For cloud-based version history
-- ============================================
CREATE TABLE IF NOT EXISTS note_versions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  note_id TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Foreign key to notes table
  CONSTRAINT fk_note FOREIGN KEY (user_id, note_id) 
    REFERENCES notes(user_id, note_id) ON DELETE CASCADE
);

-- Index for faster queries
CREATE INDEX IF NOT EXISTS note_versions_note_idx ON note_versions(user_id, note_id);
CREATE INDEX IF NOT EXISTS note_versions_created_at_idx ON note_versions(created_at DESC);

-- Enable Row Level Security
ALTER TABLE note_versions ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Users can only access their own note versions
CREATE POLICY "Users can CRUD their own note versions" ON note_versions
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Limit versions per note (keep last 50)
CREATE OR REPLACE FUNCTION cleanup_old_versions()
RETURNS TRIGGER AS $$
BEGIN
  DELETE FROM note_versions
  WHERE id IN (
    SELECT id FROM note_versions
    WHERE user_id = NEW.user_id AND note_id = NEW.note_id
    ORDER BY created_at DESC
    OFFSET 50
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER cleanup_versions_trigger
AFTER INSERT ON note_versions
FOR EACH ROW
EXECUTE FUNCTION cleanup_old_versions();


-- ============================================
-- UPDATED_AT TRIGGER
-- Auto-update updated_at timestamp
-- ============================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_notes_updated_at
BEFORE UPDATE ON notes
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_subscriptions_updated_at
BEFORE UPDATE ON subscriptions
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();


-- ============================================
-- HELPER FUNCTIONS
-- ============================================

-- Get user's subscription status (for use in RLS or functions)
CREATE OR REPLACE FUNCTION get_user_plan(uid UUID)
RETURNS TEXT AS $$
DECLARE
  user_plan TEXT;
BEGIN
  SELECT plan INTO user_plan
  FROM subscriptions
  WHERE user_id = uid
    AND status = 'active'
    AND current_period_end > NOW();
  
  RETURN COALESCE(user_plan, 'free');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Check if user has active subscription
CREATE OR REPLACE FUNCTION has_active_subscription(uid UUID)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM subscriptions
    WHERE user_id = uid
      AND status = 'active'
      AND current_period_end > NOW()
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
