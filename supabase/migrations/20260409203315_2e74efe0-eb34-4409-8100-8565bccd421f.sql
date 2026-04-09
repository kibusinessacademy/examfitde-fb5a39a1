
-- ═══════════════════════════════════════════════════════════
-- 1. Exam-Rebalance Debounce: prevent duplicate rebalance jobs within 10min per package
-- ═══════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION fn_debounce_exam_rebalance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _recent_count int;
BEGIN
  -- Only apply to exam_rebalance inserts
  IF NEW.job_type != 'package_exam_rebalance' THEN
    RETURN NEW;
  END IF;

  -- Check if a rebalance job for the same package was created in last 10 min
  SELECT COUNT(*) INTO _recent_count
  FROM job_queue
  WHERE package_id = NEW.package_id
    AND job_type = 'package_exam_rebalance'
    AND created_at > now() - interval '10 minutes'
    AND status IN ('pending', 'processing', 'completed');

  IF _recent_count > 0 THEN
    -- Skip insertion — debounce
    RAISE LOG 'DEBOUNCE: Skipping duplicate package_exam_rebalance for package % (% recent)', 
      NEW.package_id, _recent_count;
    RETURN NULL;  -- prevents the INSERT
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_debounce_exam_rebalance ON job_queue;
CREATE TRIGGER trg_debounce_exam_rebalance
  BEFORE INSERT ON job_queue
  FOR EACH ROW
  EXECUTE FUNCTION fn_debounce_exam_rebalance();

-- ═══════════════════════════════════════════════════════════
-- 2. Integrity-Check Debounce: same logic, 15min window
-- ═══════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION fn_debounce_integrity_check()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _recent_count int;
BEGIN
  IF NEW.job_type != 'package_run_integrity_check' THEN
    RETURN NEW;
  END IF;

  SELECT COUNT(*) INTO _recent_count
  FROM job_queue
  WHERE package_id = NEW.package_id
    AND job_type = 'package_run_integrity_check'
    AND created_at > now() - interval '15 minutes'
    AND status IN ('pending', 'processing', 'completed');

  IF _recent_count > 0 THEN
    RAISE LOG 'DEBOUNCE: Skipping duplicate package_run_integrity_check for package % (% recent)', 
      NEW.package_id, _recent_count;
    RETURN NULL;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_debounce_integrity_check ON job_queue;
CREATE TRIGGER trg_debounce_integrity_check
  BEFORE INSERT ON job_queue
  FOR EACH ROW
  EXECUTE FUNCTION fn_debounce_integrity_check();
