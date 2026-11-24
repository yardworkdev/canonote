-- Lock down notes so the public anon role cannot read or write user notes.
-- Safe to run multiple times.

DO $$
DECLARE
  policy_record RECORD;
BEGIN
  FOR policy_record IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'notes'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.notes', policy_record.policyname);
  END LOOP;
END
$$;

ALTER TABLE public.notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notes FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.notes FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.notes TO authenticated;

CREATE POLICY "notes_select_owner_only" ON public.notes
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "notes_insert_owner_only" ON public.notes
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "notes_update_owner_only" ON public.notes
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "notes_delete_owner_only" ON public.notes
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);
