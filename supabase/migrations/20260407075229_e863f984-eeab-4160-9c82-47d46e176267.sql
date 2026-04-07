
-- 1. Council Session Prerequisites Guard
CREATE OR REPLACE FUNCTION public.fn_guard_council_session_prerequisites()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_package_status text;
  v_validate_exam_pool text;
  v_run_integrity_check text;
BEGIN
  SELECT cp.status INTO v_package_status
  FROM course_packages cp WHERE cp.id = NEW.package_id;

  IF v_package_status IS NULL THEN
    RAISE EXCEPTION 'council_session_guard: package % not found', NEW.package_id;
  END IF;

  IF v_package_status <> 'building' THEN
    RAISE EXCEPTION 'council_session_guard: package % has status %, expected building',
      NEW.package_id, v_package_status;
  END IF;

  SELECT ps.status INTO v_validate_exam_pool
  FROM package_steps ps
  WHERE ps.package_id = NEW.package_id AND ps.step_key = 'validate_exam_pool';

  IF COALESCE(v_validate_exam_pool, 'missing') <> 'done' THEN
    RAISE EXCEPTION 'council_session_guard: package % blocked — validate_exam_pool=%',
      NEW.package_id, COALESCE(v_validate_exam_pool, 'missing');
  END IF;

  SELECT ps.status INTO v_run_integrity_check
  FROM package_steps ps
  WHERE ps.package_id = NEW.package_id AND ps.step_key = 'run_integrity_check';

  IF COALESCE(v_run_integrity_check, 'missing') <> 'done' THEN
    RAISE EXCEPTION 'council_session_guard: package % blocked — run_integrity_check=%',
      NEW.package_id, COALESCE(v_run_integrity_check, 'missing');
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_council_session_prerequisites ON public.council_sessions;
CREATE TRIGGER trg_guard_council_session_prerequisites
  BEFORE INSERT ON public.council_sessions
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_guard_council_session_prerequisites();

-- 2. Status Guard on course_packages
CREATE OR REPLACE FUNCTION public.fn_guard_council_review_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_validate_exam_pool text;
  v_run_integrity_check text;
BEGIN
  IF NEW.status = 'council_review' AND OLD.status IS DISTINCT FROM 'council_review' THEN
    SELECT ps.status INTO v_validate_exam_pool
    FROM package_steps ps
    WHERE ps.package_id = NEW.id AND ps.step_key = 'validate_exam_pool';

    IF COALESCE(v_validate_exam_pool, 'missing') <> 'done' THEN
      RAISE EXCEPTION 'council_review_guard: package % blocked — validate_exam_pool=%',
        NEW.id, COALESCE(v_validate_exam_pool, 'missing');
    END IF;

    SELECT ps.status INTO v_run_integrity_check
    FROM package_steps ps
    WHERE ps.package_id = NEW.id AND ps.step_key = 'run_integrity_check';

    IF COALESCE(v_run_integrity_check, 'missing') <> 'done' THEN
      RAISE EXCEPTION 'council_review_guard: package % blocked — run_integrity_check=%',
        NEW.id, COALESCE(v_run_integrity_check, 'missing');
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_council_review_status ON public.course_packages;
CREATE TRIGGER trg_guard_council_review_status
  BEFORE UPDATE OF status ON public.course_packages
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_guard_council_review_status();

-- 3. BWL Bachelor data heal
-- Mark invalid pending sessions as 'failed' (allowed by check constraint)
UPDATE public.council_sessions
SET status = 'failed'
WHERE package_id = 'a0b0c0d0-0010-4000-8000-000000000001'
  AND status = 'pending';

-- Reset package status to building (temporarily disable the new guard)
ALTER TABLE public.course_packages DISABLE TRIGGER trg_guard_council_review_status;

UPDATE public.course_packages
SET status = 'building', updated_at = now()
WHERE id = 'a0b0c0d0-0010-4000-8000-000000000001';

ALTER TABLE public.course_packages ENABLE TRIGGER trg_guard_council_review_status;
