CREATE OR REPLACE FUNCTION public.admin_dispatch_lessons_gap_repair(
  _wave_size integer DEFAULT 10,
  _wip_cap integer DEFAULT 20,
  _force_no_modules boolean DEFAULT false,
  _dry_run boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_current_wip int;
  v_capacity int;
  v_eligible_count int;
  v_dispatched int := 0;
  v_skipped int := 0;
  v_results jsonb := '[]'::jsonb;
  v_curriculum_id uuid;
  r record;
BEGIN
  IF NOT (
    public.has_role(auth.uid(), 'admin')
    OR coalesce(auth.role(), current_user) IN ('service_role','postgres','supabase_admin')
  ) THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;

  SELECT COUNT(*) INTO v_current_wip
  FROM public.job_queue
  WHERE job_type IN ('post_publish_content_repair_lessons','package_scaffold_learning_course')
    AND status IN ('pending','processing','queued','running','retry');

  v_capacity := GREATEST(0, LEAST(_wave_size, _wip_cap - v_current_wip));

  SELECT COUNT(*) INTO v_eligible_count
  FROM public.v_lessons_gap_ssot v
  WHERE v.active_repair_jobs = 0
    AND (v.classification = 'LESSONS_NOT_READY'
         OR (v.classification = 'NO_MODULES' AND _force_no_modules));

  IF _dry_run THEN
    RETURN jsonb_build_object('dry_run', true, 'current_wip', v_current_wip,
      'wip_cap', _wip_cap, 'capacity', v_capacity, 'eligible_count', v_eligible_count,
      'would_dispatch', LEAST(v_capacity, v_eligible_count));
  END IF;

  FOR r IN
    SELECT v.package_id, v.package_key, v.classification, v.lesson_draft_count
    FROM public.v_lessons_gap_ssot v
    WHERE v.active_repair_jobs = 0
      AND (v.classification = 'LESSONS_NOT_READY'
           OR (v.classification = 'NO_MODULES' AND _force_no_modules))
    ORDER BY CASE v.classification WHEN 'LESSONS_NOT_READY' THEN 0 ELSE 1 END,
             v.lesson_draft_count DESC NULLS LAST
    LIMIT v_capacity
  LOOP
    BEGIN
      SELECT cp.curriculum_id INTO v_curriculum_id
      FROM public.course_packages cp WHERE cp.id = r.package_id;

      INSERT INTO public.job_queue (
        job_type, package_id, payload, status, priority, job_name, correlation_id
      ) VALUES (
        CASE r.classification WHEN 'LESSONS_NOT_READY' THEN 'post_publish_content_repair_lessons'
          ELSE 'package_scaffold_learning_course' END,
        r.package_id,
        jsonb_build_object(
          'enqueue_source', 'lessons_gap_dispatcher_v1',
          'classification', r.classification,
          'wave_dispatched_at', now(),
          'package_id', r.package_id,
          'curriculum_id', v_curriculum_id
        ),
        'pending', 5,
        'lessons_gap_repair|' || r.package_key,
        gen_random_uuid()
      );
      v_dispatched := v_dispatched + 1;
      v_results := v_results || jsonb_build_object(
        'package_id', r.package_id, 'package_key', r.package_key,
        'classification', r.classification, 'status', 'dispatched');

      PERFORM public.fn_emit_audit(
        _action_type   := 'lessons_gap_repair_dispatched',
        _target_type   := 'package',
        _target_id     := r.package_id::text,
        _result_status := 'success',
        _payload       := jsonb_build_object('classification', r.classification,
                            'lesson_draft_count', r.lesson_draft_count,
                            'package_key', r.package_key),
        _trigger_source := 'admin_dispatch_lessons_gap_repair',
        _error_message  := NULL
      );
    EXCEPTION WHEN OTHERS THEN
      v_skipped := v_skipped + 1;
      v_results := v_results || jsonb_build_object(
        'package_id', r.package_id, 'package_key', r.package_key,
        'status', 'skipped', 'error', SQLERRM);
      PERFORM public.fn_emit_audit(
        _action_type   := 'lessons_gap_repair_skipped',
        _target_type   := 'package',
        _target_id     := r.package_id::text,
        _result_status := 'failed',
        _payload       := jsonb_build_object('classification', r.classification,
                            'package_key', r.package_key),
        _trigger_source := 'admin_dispatch_lessons_gap_repair',
        _error_message  := SQLERRM
      );
    END;
  END LOOP;

  RETURN jsonb_build_object('dry_run', false, 'current_wip', v_current_wip,
    'wip_cap', _wip_cap, 'capacity', v_capacity, 'eligible_count', v_eligible_count,
    'dispatched', v_dispatched, 'skipped', v_skipped, 'results', v_results);
END $function$;

-- Wave 2 Re-Dispatch
DO $$
DECLARE v_result jsonb;
BEGIN
  v_result := public.admin_dispatch_lessons_gap_repair(10, 20, false, false);
  INSERT INTO public.auto_heal_log (action_type, target_type, result_status, metadata)
  VALUES ('lessons_gap_repair_dispatched', 'system', 'ok',
          jsonb_build_object('wave', 2, 'retry', true, 'dispatch_result', v_result));
  RAISE NOTICE 'Wave 2 re-dispatch: %', v_result;
END $$;