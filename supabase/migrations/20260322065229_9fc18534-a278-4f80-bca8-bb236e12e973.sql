-- Re-apply only the mastery guard if table exists (skip if not)
-- The pipeline_dag_edges RLS and exam_score guard already applied successfully

-- Verify: create the score guard function standalone (idempotent)
CREATE OR REPLACE FUNCTION fn_guard_exam_score_manipulation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF TG_OP = 'UPDATE' 
     AND NEW.score IS DISTINCT FROM OLD.score
     AND current_setting('role', true) != 'service_role' THEN
    INSERT INTO public.admin_actions (action, scope, payload)
    VALUES (
      'exam_score_tampering_blocked',
      'exam_attempts',
      jsonb_build_object(
        'attempt_id', NEW.id,
        'old_score', OLD.score,
        'attempted_score', NEW.score,
        'role', current_setting('role', true)
      )
    );
    NEW.score := OLD.score;
  END IF;
  RETURN NEW;
END;
$$;

-- Ensure trigger exists
DROP TRIGGER IF EXISTS trg_guard_exam_score ON public.exam_attempts;
CREATE TRIGGER trg_guard_exam_score
  BEFORE UPDATE ON public.exam_attempts
  FOR EACH ROW
  EXECUTE FUNCTION fn_guard_exam_score_manipulation();