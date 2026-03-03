-- Hardening trigger: auto-clean garbled taetigkeitsprofil on insert/update
CREATE OR REPLACE FUNCTION public.clean_taetigkeitsprofil_on_write()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.taetigkeitsprofil IS NOT NULL THEN
    IF NEW.taetigkeitsprofil ~ 'sp[0-9]+S[0-9]+' OR length(trim(NEW.taetigkeitsprofil)) < 25 THEN
      NEW.taetigkeitsprofil := NULL;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_clean_taetigkeitsprofil ON public.berufe;
CREATE TRIGGER trg_clean_taetigkeitsprofil
BEFORE INSERT OR UPDATE OF taetigkeitsprofil
ON public.berufe
FOR EACH ROW
EXECUTE FUNCTION public.clean_taetigkeitsprofil_on_write();