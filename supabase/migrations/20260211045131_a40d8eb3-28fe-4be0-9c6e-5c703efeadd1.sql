-- Hard Publish Guard: DB-Trigger verhindert publishing_status='published' ohne seal+score>=85
CREATE OR REPLACE FUNCTION public.guard_publish_requires_seal()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.publishing_status = 'published' THEN
    IF NEW.autopilot_status IS DISTINCT FROM 'sealed' THEN
      RAISE EXCEPTION 'PUBLISH_BLOCKED: Kurs muss sealed sein (aktuell: %)', COALESCE(NEW.autopilot_status, 'null');
    END IF;
    IF COALESCE(NEW.quality_score, 0) < 85 THEN
      RAISE EXCEPTION 'PUBLISH_BLOCKED: quality_score muss >= 85 sein (aktuell: %)', COALESCE(NEW.quality_score, 0);
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS guard_publish_requires_seal ON public.courses;
CREATE TRIGGER guard_publish_requires_seal
  BEFORE UPDATE ON public.courses
  FOR EACH ROW
  WHEN (NEW.publishing_status = 'published')
  EXECUTE FUNCTION public.guard_publish_requires_seal();