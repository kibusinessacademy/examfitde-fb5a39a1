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
  v_origin text;
BEGIN
  IF NEW.job_type <> 'package_repair_exam_pool_quality' THEN
    RETURN NEW;
  END IF;

  IF NEW.package_id IS NULL THEN
    RETURN NEW;
  END IF;

  v_enqueue_source := NEW.payload->>'enqueue_source';
  v_origin := NEW.payload->>'_origin';

  -- Bypass: Content-Gap-Top-Up auf Zombie-Paketen
  IF v_enqueue_source = 'content_gap_topup' THEN
    SELECT blocked_reason INTO v_blocked_reason
    FROM public.course_packages WHERE id = NEW.package_id;
    IF v_blocked_reason = 'auto_heal_zombie' THEN
      RETURN NEW;
    END IF;
  END IF;

  -- Bypass: Bronze Quality-Lift (admin manual dispatch) — explicit + audited
  IF v_enqueue_source = 'bronze_quality_lift'
     OR v_origin = 'bronze_quality_lift'
     OR v_origin = 'bronze_targeted_repair' THEN
    INSERT INTO auto_heal_log (trigger_source, action_type, target_id, target_type, result_status, result_detail, metadata)
    VALUES ('fn_guard_phantom_repair_enqueue','phantom_repair_bronze_lift_bypass',
            NEW.package_id::text,'package','success',
            'Bronze quality-lift bypass granted for repair_exam_pool_quality',
            jsonb_build_object('package_id', NEW.package_id, 'enqueue_source', v_enqueue_source, 'origin', v_origin));
    RETURN NEW;
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