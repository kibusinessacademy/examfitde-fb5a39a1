CREATE OR REPLACE FUNCTION public.strip_curriculum_title_suffixes()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- Strip known technical suffixes from title
  NEW.title := REGEXP_REPLACE(NEW.title, '\s*–\s*Curriculum\s*$', '', 'i');
  NEW.title := REGEXP_REPLACE(NEW.title, '\s*–\s*Modulprüfungen\s+Bachelor\s*$', '', 'i');
  NEW.title := REGEXP_REPLACE(NEW.title, '\s*–\s*Modulhandbuch\s+Pilot\s*$', '', 'i');
  NEW.title := REGEXP_REPLACE(NEW.title, '\s*–\s*Modulhandbuch\s*$', '', 'i');
  NEW.title := TRIM(NEW.title);
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_strip_curriculum_title_suffixes
  BEFORE INSERT OR UPDATE OF title ON public.curricula
  FOR EACH ROW
  EXECUTE FUNCTION public.strip_curriculum_title_suffixes();