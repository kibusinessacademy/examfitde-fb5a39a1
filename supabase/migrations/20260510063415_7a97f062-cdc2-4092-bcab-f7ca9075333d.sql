CREATE OR REPLACE FUNCTION public.admin_soft_drift_mc_repair(p_package_ids uuid[], p_apply boolean DEFAULT false)
 RETURNS TABLE(package_id uuid, package_title text, track text, unapproved_count bigint, approval_pct numeric, action text, job_id uuid, reason text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller_admin boolean;
  v_pkg record;
  v_unapproved bigint;
  v_approval numeric;
  v_active_job uuid;
  v_new_job uuid;
  v_lessons_total bigint;
BEGIN
  v_caller_admin := COALESCE(has_role(auth.uid(),'admin'), false)
                    OR (current_setting('role', true) IN ('service_role','postgres'))
                    OR (current_user IN ('postgres','supabase_admin'))
                    OR (session_user IN ('postgres','supabase_admin'));
  IF NOT v_caller_admin THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED' USING ERRCODE = '42501';
  END IF;

  FOR v_pkg IN
    SELECT cp.id, cp.title, cp.track::text AS track, cp.curriculum_id, cp.status::text AS status
    FROM course_packages cp
    WHERE cp.id = ANY(p_package_ids)
  LOOP
    IF v_pkg.status <> 'published' THEN
      package_id := v_pkg.id; package_title := v_pkg.title; track := v_pkg.track;
      unapproved_count := 0; approval_pct := 0;
      action := 'skip'; job_id := NULL; reason := 'package_not_published:' || v_pkg.status;
      RETURN NEXT; CONTINUE;
    END IF;

    IF v_pkg.track = 'EXAM_FIRST' THEN
      package_id := v_pkg.id; package_title := v_pkg.title; track := v_pkg.track;
      unapproved_count := 0; approval_pct := 0;
      action := 'skip'; job_id := NULL; reason := 'track_not_applicable_exam_first';
      RETURN NEXT; CONTINUE;
    END IF;

    SELECT COUNT(*) INTO v_lessons_total
    FROM v_mc_unapproved_per_package v
    WHERE v.package_id = v_pkg.id;

    IF v_lessons_total = 0 THEN
      package_id := v_pkg.id; package_title := v_pkg.title; track := v_pkg.track;
      unapproved_count := 0; approval_pct := 0;
      action := 'skip'; job_id := NULL; reason := 'no_lessons_in_package';
      RETURN NEXT; CONTINUE;
    END IF;

    SELECT SUM(unapproved),
           CASE WHEN SUM(total)=0 THEN 0
                ELSE ROUND(SUM(approved)::numeric / NULLIF(SUM(total),0)::numeric * 100, 1) END
      INTO v_unapproved, v_approval
    FROM public.v_mc_unapproved_per_package
    WHERE v_mc_unapproved_per_package.package_id = v_pkg.id;

    IF COALESCE(v_unapproved,0) = 0 THEN
      package_id := v_pkg.id; package_title := v_pkg.title; track := v_pkg.track;
      unapproved_count := 0; approval_pct := COALESCE(v_approval,0);
      action := 'skip'; job_id := NULL; reason := 'no_unapproved_mcs';
      RETURN NEXT; CONTINUE;
    END IF;

    SELECT id INTO v_active_job
    FROM job_queue
    WHERE (payload->>'package_id')::uuid = v_pkg.id
      AND job_type IN ('package_repair_lesson_minichecks',
                       'package_generate_lesson_minichecks',
                       'package_validate_lesson_minichecks')
      AND status IN ('pending','processing')
    LIMIT 1;

    IF v_active_job IS NOT NULL THEN
      package_id := v_pkg.id; package_title := v_pkg.title; track := v_pkg.track;
      unapproved_count := v_unapproved; approval_pct := v_approval;
      action := 'skip'; job_id := v_active_job; reason := 'active_mc_job_exists';
      RETURN NEXT; CONTINUE;
    END IF;

    IF p_apply THEN
      INSERT INTO job_queue (job_type, status, run_after, payload, meta, priority)
      VALUES (
        'package_repair_lesson_minichecks', 'pending', now(),
        jsonb_build_object(
          'package_id', v_pkg.id,
          'curriculum_id', v_pkg.curriculum_id,
          'mode','soft_drift_targeted_mc_repair',
          'target','unapproved_minichecks',
          'enqueue_source','soft_drift_mc_required_repair'
        ),
        jsonb_build_object(
          'wave','soft_drift_mc',
          'previous_mc_approval_pct', v_approval,
          'previous_unapproved_count', v_unapproved
        ),
        50
      )
      RETURNING id INTO v_new_job;

      INSERT INTO public.auto_heal_log (action_type, target_type, target_id, result_status, metadata)
      VALUES (
        'soft_drift_mc_required_repair','course_package', v_pkg.id, 'enqueued',
        jsonb_build_object(
          'job_id', v_new_job,
          'wave','soft_drift_mc',
          'unapproved', v_unapproved,
          'approval_pct', v_approval,
          'track', v_pkg.track
        )
      );

      package_id := v_pkg.id; package_title := v_pkg.title; track := v_pkg.track;
      unapproved_count := v_unapproved; approval_pct := v_approval;
      action := 'enqueued'; job_id := v_new_job; reason := 'apply:repair_job_created';
      RETURN NEXT;
    ELSE
      package_id := v_pkg.id; package_title := v_pkg.title; track := v_pkg.track;
      unapproved_count := v_unapproved; approval_pct := v_approval;
      action := 'dry_run'; job_id := NULL; reason := 'dry_run:eligible_for_repair';
      RETURN NEXT;
    END IF;
  END LOOP;
END;
$function$;

DO $$
DECLARE
  r record;
  v_summary jsonb := '[]'::jsonb;
BEGIN
  FOR r IN
    SELECT * FROM public.admin_soft_drift_mc_repair(
      ARRAY[
        '96d0fb31-9951-408d-a83e-b2937f5a6af8'::uuid,
        '6a2c6859-4b3b-4f6e-b32d-c2574a1333ad'::uuid,
        '24c3793c-30b0-43a7-bd5d-cfed0c40542d'::uuid
      ],
      true
    )
  LOOP
    v_summary := v_summary || jsonb_build_object(
      'package_id', r.package_id,
      'title', r.package_title,
      'track', r.track,
      'unapproved', r.unapproved_count,
      'approval_pct', r.approval_pct,
      'action', r.action,
      'job_id', r.job_id,
      'reason', r.reason
    );
  END LOOP;

  INSERT INTO public.auto_heal_log (action_type, target_type, target_id, result_status, metadata)
  VALUES (
    'soft_drift_mc_required_repair_apply_batch',
    'system', NULL, 'success',
    jsonb_build_object('wave','soft_drift_mc','results', v_summary)
  );
END $$;