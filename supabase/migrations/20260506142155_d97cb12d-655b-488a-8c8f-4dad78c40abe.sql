
CREATE OR REPLACE FUNCTION public.fn_guard_phantom_repair_enqueue()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_step_status text;
  v_step_key text;
  v_blocked_reason text;
  v_enqueue_source text;
BEGIN
  IF NEW.job_type <> 'package_repair_exam_pool_quality' THEN
    RETURN NEW;
  END IF;

  IF NEW.package_id IS NULL THEN
    RETURN NEW;
  END IF;

  v_enqueue_source := NEW.payload->>'enqueue_source';

  -- Bypass: Content-Gap-Top-Up auf zurecht-blockierten Zombie-Paketen
  IF v_enqueue_source = 'content_gap_topup' THEN
    SELECT blocked_reason INTO v_blocked_reason
    FROM public.course_packages WHERE id = NEW.package_id;
    IF v_blocked_reason = 'auto_heal_zombie' THEN
      RETURN NEW;
    END IF;
  END IF;

  v_step_key := 'generate_exam_pool';

  SELECT status INTO v_step_status
  FROM public.package_steps
  WHERE package_id = NEW.package_id AND step_key = v_step_key;

  IF v_step_status IN ('done', 'skipped') THEN
    RAISE EXCEPTION 'PHANTOM_REPAIR_BLOCKED: package_repair_exam_pool_quality skipped — step % already %', v_step_key, v_step_status
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$function$;
