
-- REMEDIATION Step 1: Reset false council_approved flags (4 packages)
UPDATE public.course_packages
SET
  council_approved = false,
  council_approved_at = NULL,
  updated_at = now()
WHERE id IN (
  'd173ff82-6ab7-4853-a5c2-ad57254c7dce',
  '7feb726e-f699-4d42-9cbc-970a650d00a5',
  '5377ab93-fe17-488c-a266-bdb26b672da7',
  '7da17ef9-3b64-4378-9200-449107e46362'
)
AND council_approved = true;

-- GUARD TRIGGER: Prevent council_approved=true when sessions incomplete
CREATE OR REPLACE FUNCTION public.fn_guard_council_approved()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_incomplete int;
BEGIN
  IF NEW.council_approved = true AND (OLD.council_approved IS DISTINCT FROM true) THEN
    SELECT count(*)
      INTO v_incomplete
      FROM public.council_sessions cs
     WHERE cs.package_id = NEW.id
       AND cs.status IN ('pending', 'processing');

    IF v_incomplete > 0 THEN
      RAISE WARNING '[SSOT Guard] Blocked council_approved=true for package % — % sessions still incomplete', NEW.id, v_incomplete;
      NEW.council_approved := false;
      NEW.council_approved_at := NULL;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_council_approved ON public.course_packages;
CREATE TRIGGER trg_guard_council_approved
  BEFORE UPDATE ON public.course_packages
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_guard_council_approved();
