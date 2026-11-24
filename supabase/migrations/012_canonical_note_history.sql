-- Durable recovery history for every canonical note content change.
-- Safe to run multiple times after 010_notes_authoritative_state.sql.

CREATE TABLE IF NOT EXISTS public.note_versions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  note_id TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS note_versions_note_idx
  ON public.note_versions(user_id, note_id);

CREATE INDEX IF NOT EXISTS note_versions_created_at_idx
  ON public.note_versions(created_at DESC);

ALTER TABLE public.note_versions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "note_versions_owner_only" ON public.note_versions;
CREATE POLICY "note_versions_owner_only" ON public.note_versions
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

ALTER TABLE IF EXISTS public.note_versions
  ADD COLUMN IF NOT EXISTS revision BIGINT,
  ADD COLUMN IF NOT EXISTS title TEXT,
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS actor_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS note_versions_note_revision_idx
  ON public.note_versions(user_id, note_id, revision)
  WHERE revision IS NOT NULL;

CREATE OR REPLACE FUNCTION public.record_canonical_note_version()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT'
     OR OLD.content IS DISTINCT FROM NEW.content
     OR OLD.title IS DISTINCT FROM NEW.title THEN
    INSERT INTO public.note_versions (
      user_id,
      note_id,
      revision,
      title,
      content,
      source,
      actor_id,
      created_at
    ) VALUES (
      NEW.user_id,
      NEW.note_id,
      NEW.version,
      NEW.title,
      COALESCE(NEW.content, ''),
      CASE
        WHEN COALESCE(NEW.updated_by, NEW.created_by, '') = 'agent_rudi' THEN 'agent'
        ELSE 'editor'
      END,
      COALESCE(NEW.updated_by, NEW.created_by),
      COALESCE(NEW.updated_at, NOW())
    )
    ON CONFLICT (user_id, note_id, revision) WHERE revision IS NOT NULL DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS record_canonical_note_version_trigger ON public.notes;
CREATE TRIGGER record_canonical_note_version_trigger
AFTER INSERT OR UPDATE OF content, title ON public.notes
FOR EACH ROW
EXECUTE FUNCTION public.record_canonical_note_version();
