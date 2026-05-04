CREATE OR REPLACE FUNCTION public.fn_is_redundant_content_step(
  p_package_id uuid,
  p_step_key text
) RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_approved int;
  v_total int;
  v_pool_validated boolean;
BEGIN
  IF p_step_key NOT IN ('generate_learning_content','generate_lesson_minichecks') THEN
    RETURN false;
  END IF;

  SELECT count(*) FILTER (WHERE status='approved'), count(*)
    INTO v_approved, v_total
  FROM exam_questions WHERE package_id = p_package_id;

  SELECT EXISTS (
    SELECT 1 FROM package_steps
    WHERE package_id = p_package_id
      AND step_key = 'validate_exam_pool'
      AND status IN ('done','skipped')
  ) INTO v_pool_validated;

  RETURN (
    (v_approved >= 1000 AND v_pool_validated)
    OR (v_total >= 500 AND v_approved::float / NULLIF(v_total,0) >= 0.9)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_is_redundant_content_step(uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_is_redundant_content_step(uuid,text) TO service_role;

CREATE OR REPLACE FUNCTION public.fn_guard_redundant_content_step_enqueue()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_step_key text;
  v_had_reap boolean;
BEGIN
  IF NEW.job_type NOT IN ('package_generate_learning_content','package_generate_lesson_minichecks') THEN
    RETURN NEW;
  END IF;
  IF NEW.package_id IS NULL THEN
    RETURN NEW;
  END IF;

  v_step_key := CASE NEW.job_type
    WHEN 'package_generate_learning_content' THEN 'generate_learning_content'
    WHEN 'package_generate_lesson_minichecks' THEN 'generate_lesson_minichecks'
  END;

  SELECT EXISTS (
    SELECT 1 FROM job_queue
    WHERE package_id = NEW.package_id
      AND job_type = NEW.job_type
      AND last_error_code = 'STALE_REAP_LOOP_TERMINAL'
      AND created_at > now() - interval '24 hours'
  ) INTO v_had_reap;

  IF NOT v_had_reap THEN
    RETURN NEW;
  END IF;

  IF (NEW.payload->>'force_redundant_content_override')::boolean IS TRUE THEN
    RETURN NEW;
  END IF;

  IF public.fn_is_redundant_content_step(NEW.package_id, v_step_key) THEN
    UPDATE package_steps
       SET status = 'skipped',
           meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object(
             'skip_reason','redundant_content_step_after_stale_reap',
             'skipped_at', now(),
             'auto_skip', true
           )
     WHERE package_id = NEW.package_id
       AND step_key = v_step_key
       AND status NOT IN ('done','skipped');

    INSERT INTO auto_heal_log(action_type, target_type, target_id, result_status, metadata)
    VALUES (
      'redundant_content_step_enqueue_blocked',
      'package', NEW.package_id, 'blocked',
      jsonb_build_object(
        'job_type', NEW.job_type,
        'step_key', v_step_key,
        'reason','STALE_REAP_LOOP_TERMINAL_with_pool_full',
        'enqueue_source', NEW.payload->>'enqueue_source'
      )
    );
    RETURN NULL;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_redundant_content_step ON public.job_queue;
CREATE TRIGGER trg_guard_redundant_content_step
  BEFORE INSERT ON public.job_queue
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_guard_redundant_content_step_enqueue();

-- Backfill
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT DISTINCT package_id, job_type,
      CASE job_type
        WHEN 'package_generate_learning_content' THEN 'generate_learning_content'
        WHEN 'package_generate_lesson_minichecks' THEN 'generate_lesson_minichecks'
      END AS step_key
    FROM job_queue
    WHERE last_error_code = 'STALE_REAP_LOOP_TERMINAL'
      AND job_type IN ('package_generate_learning_content','package_generate_lesson_minichecks')
      AND created_at > now() - interval '24 hours'
  LOOP
    IF public.fn_is_redundant_content_step(r.package_id, r.step_key) THEN
      UPDATE job_queue
         SET status = 'failed',
             completed_at = now(),
             last_error_code = 'REDUNDANT_CONTENT_STEP_SKIPPED',
             last_error = 'Backfill: pool full after STALE_REAP_LOOP_TERMINAL',
             liveness_status = 'terminal'
       WHERE package_id = r.package_id
         AND job_type = r.job_type
         AND status IN ('pending','queued');

      UPDATE package_steps
         SET status = 'skipped',
             meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object(
               'skip_reason','redundant_content_step_after_stale_reap_backfill',
               'skipped_at', now(),
               'auto_skip', true
             )
       WHERE package_id = r.package_id
         AND step_key = r.step_key
         AND status NOT IN ('done','skipped');

      INSERT INTO auto_heal_log(action_type, target_type, target_id, result_status, metadata)
      VALUES (
        'redundant_content_step_backfill_skip',
        'package', r.package_id, 'success',
        jsonb_build_object('job_type', r.job_type, 'step_key', r.step_key)
      );
    END IF;
  END LOOP;
END $$;