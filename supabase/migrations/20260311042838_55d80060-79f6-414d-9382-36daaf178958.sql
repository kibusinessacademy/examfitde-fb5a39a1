
-- Auto-clear is_rebuild flag when package reaches terminal state
CREATE OR REPLACE FUNCTION public.trg_clear_rebuild_flag()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status IN ('published', 'done', 'archived') AND NEW.is_rebuild = true THEN
    NEW.is_rebuild := false;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_clear_rebuild_on_complete ON public.course_packages;
CREATE TRIGGER trg_clear_rebuild_on_complete
  BEFORE UPDATE ON public.course_packages
  FOR EACH ROW
  WHEN (NEW.status IN ('published', 'done', 'archived'))
  EXECUTE FUNCTION public.trg_clear_rebuild_flag();
