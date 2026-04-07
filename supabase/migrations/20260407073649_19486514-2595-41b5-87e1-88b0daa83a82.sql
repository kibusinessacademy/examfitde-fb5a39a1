
-- 1. Normalizer function
CREATE OR REPLACE FUNCTION public.fn_normalize_curriculum_slug(p_title text)
RETURNS text
LANGUAGE sql IMMUTABLE STRICT
AS $$
  SELECT lower(
    regexp_replace(
      regexp_replace(
        regexp_replace(
          regexp_replace(
            trim(p_title),
            '(examfit|prüfungsvorbereitung|prüfungstraining|sachkundeprüfung|vorbereitung|kurs|prüfung)\s*[-–]?\s*', '', 'gi'
          ),
          '\s*(ihk|hwk|tüv)\s*', ' ', 'gi'
        ),
        '\s+', ' ', 'g'
      ),
      '^\s+|\s+$', '', 'g'
    )
  );
$$;

-- 2. Expression index for fast slug lookups
CREATE INDEX IF NOT EXISTS idx_curricula_norm_slug
  ON public.curricula (public.fn_normalize_curriculum_slug(title));

-- 3. Trigger guard
CREATE OR REPLACE FUNCTION public.fn_guard_curriculum_dedup()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_slug text;
  v_existing_id uuid;
BEGIN
  v_slug := fn_normalize_curriculum_slug(NEW.title);
  
  SELECT c.id INTO v_existing_id
  FROM curricula c
  LEFT JOIN course_packages cp ON cp.curriculum_id = c.id
  WHERE fn_normalize_curriculum_slug(c.title) = v_slug
    AND c.id != NEW.id
    AND (cp.id IS NULL OR cp.status != 'archived')
  LIMIT 1;
  
  IF v_existing_id IS NOT NULL THEN
    RAISE EXCEPTION 'SSOT_CURRICULUM_DUPLICATE: title "%" normalizes to slug "%" which already exists in curriculum %',
      NEW.title, v_slug, v_existing_id;
  END IF;
  
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_curriculum_dedup ON public.curricula;
CREATE TRIGGER trg_guard_curriculum_dedup
  BEFORE INSERT OR UPDATE OF title ON public.curricula
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_guard_curriculum_dedup();
