-- Keep canonical recovery history bounded to the 50 newest versions per note.

CREATE OR REPLACE FUNCTION public.cleanup_canonical_note_versions()
RETURNS TRIGGER AS $$
BEGIN
  DELETE FROM public.note_versions
  WHERE id IN (
    SELECT id
    FROM public.note_versions
    WHERE user_id = NEW.user_id
      AND note_id = NEW.note_id
    ORDER BY created_at DESC, id DESC
    OFFSET 50
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS cleanup_canonical_note_versions_trigger ON public.note_versions;
CREATE TRIGGER cleanup_canonical_note_versions_trigger
AFTER INSERT ON public.note_versions
FOR EACH ROW
EXECUTE FUNCTION public.cleanup_canonical_note_versions();
