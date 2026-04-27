-- Single Resume — robust gegen "Job existiert bereits"
CREATE OR REPLACE FUNCTION public.admin_resume_single_council_deferred(p_package_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_cleared int;
  v_step_updated int;
  v_curriculum_id uuid;
  v_existing_job uuid;
  v_enqueued boolean := false;
BEGIN
  IF NOT public.is_admin(v_uid) THEN
    RAISE EXCEPTION 'permission denied: admin only';
  END IF;

  IF p_package_id IS NULL THEN
    RAISE EXCEPTION 'package_id required';
  END IF;

  SELECT cp.curriculum_id INTO v_curriculum_id
  FROM public.course_packages cp WHERE cp.id = p_package_id;

  IF v_curriculum_id IS NULL THEN
    RAISE EXCEPTION 'package % has no curriculum_id (cannot resume)', p_package_id;
  END IF;

  WITH x AS (
    UPDATE public.council_defer_log
    SET cleared_at = now(),
        meta = coalesce(meta, '{}'::jsonb) || jsonb_build_object(
          'cleared_by','admin_single_resume','cleared_admin', v_uid
        )
    WHERE package_id = p_package_id AND cleared_at IS NULL
    RETURNING 1
  )
  SELECT count(*) INTO v_cleared FROM x;

  WITH y AS (
    UPDATE public.package_steps
    SET status = 'queued',
        attempts = 0,
        meta = coalesce(meta, '{}'::jsonb) || jsonb_build_object(
          'allow_regression', true,
          'allow_regression_by', 'admin_single_resume_council',
          'reset_reason', 'manual_admin_resume',
          'reset_at', now()::text,
          'council_defer_cleared', true
        ),
        updated_at = now()
    WHERE package_id = p_package_id
      AND step_key = 'quality_council'
      AND status::text IN ('failed', 'pending', 'pending_enqueue', 'skipped')
    RETURNING 1
  )
  SELECT count(*) INTO v_step_updated FROM y;

  -- Atomic-Trigger könnte den Job bereits angelegt haben → idempotent prüfen
  SELECT id INTO v_existing_job
  FROM public.job_queue
  WHERE package_id = p_package_id
    AND job_type = 'package_quality_council'
    AND status IN ('pending','processing')
  LIMIT 1;

  IF v_existing_job IS NULL THEN
    BEGIN
      PERFORM public.enqueue_job_if_absent(
        'package_quality_council'::text,
        p_package_id,
        jsonb_build_object(
          'package_id', p_package_id,
          'curriculum_id', v_curriculum_id,
          'resumed_from_defer', true,
          'manual', true
        )
      );
      v_enqueued := true;
    EXCEPTION WHEN unique_violation THEN
      v_enqueued := false; -- Trigger war schneller, kein Fehler
    END;
  END IF;

  INSERT INTO public.admin_actions (user_id, action, payload, scope, affected_ids)
  VALUES (
    v_uid,
    'admin_resume_single_council_deferred',
    jsonb_build_object(
      'package_id', p_package_id,
      'curriculum_id', v_curriculum_id,
      'defer_cleared', v_cleared,
      'step_updated', v_step_updated,
      'job_enqueued_by_rpc', v_enqueued,
      'job_existed_before', v_existing_job IS NOT NULL
    ),
    'package',
    ARRAY[p_package_id]
  );

  RETURN jsonb_build_object(
    'ok', true,
    'package_id', p_package_id,
    'curriculum_id', v_curriculum_id,
    'defer_cleared', v_cleared,
    'step_updated', v_step_updated,
    'job_enqueued_by_rpc', v_enqueued,
    'job_existed_before', v_existing_job IS NOT NULL
  );
END;
$function$;

-- Bulk Resume — robust gegen unique_violation pro Paket
CREATE OR REPLACE FUNCTION public.admin_resume_council_deferred(
  p_dry_run boolean DEFAULT true,
  p_max_packages integer DEFAULT 20
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_targets uuid[];
  v_pkg uuid;
  v_curr uuid;
  v_per_pkg jsonb := '[]'::jsonb;
  v_total int := 0;
  v_skipped int := 0;
  v_existing uuid;
  v_action text;
BEGIN
  IF NOT public.is_admin(v_uid) THEN
    RAISE EXCEPTION 'permission denied: admin only';
  END IF;

  SELECT array_agg(DISTINCT cdl.package_id)
  INTO v_targets
  FROM public.council_defer_log cdl
  WHERE cdl.cleared_at IS NULL
    AND cdl.deferred_at > now() - interval '30 days'
  LIMIT p_max_packages;

  IF v_targets IS NULL OR array_length(v_targets, 1) IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'dry_run', p_dry_run, 'packages', 0, 'per_package', '[]'::jsonb);
  END IF;

  IF p_dry_run THEN
    SELECT jsonb_agg(jsonb_build_object(
      'package_id', cdl.package_id,
      'curriculum_id', cp.curriculum_id,
      'has_curriculum', cp.curriculum_id IS NOT NULL,
      'fail_count', cdl.fail_count,
      'defer_reason', cdl.defer_reason,
      'deferred_at', cdl.deferred_at
    ))
    INTO v_per_pkg
    FROM public.council_defer_log cdl
    LEFT JOIN public.course_packages cp ON cp.id = cdl.package_id
    WHERE cdl.package_id = ANY(v_targets) AND cdl.cleared_at IS NULL;

    RETURN jsonb_build_object(
      'ok', true,
      'dry_run', true,
      'packages', array_length(v_targets, 1),
      'per_package', coalesce(v_per_pkg, '[]'::jsonb)
    );
  END IF;

  FOREACH v_pkg IN ARRAY v_targets LOOP
    SELECT cp.curriculum_id INTO v_curr FROM public.course_packages cp WHERE cp.id = v_pkg;

    IF v_curr IS NULL THEN
      v_per_pkg := v_per_pkg || jsonb_build_object('package_id', v_pkg, 'action', 'skipped_no_curriculum');
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    UPDATE public.council_defer_log
    SET cleared_at = now(),
        meta = coalesce(meta, '{}'::jsonb) || jsonb_build_object(
          'cleared_by', 'admin_resume_council_deferred', 'cleared_admin', v_uid
        )
    WHERE package_id = v_pkg AND cleared_at IS NULL;

    UPDATE public.package_steps
    SET status = 'queued', attempts = 0,
        meta = coalesce(meta, '{}'::jsonb) || jsonb_build_object(
          'allow_regression', true,
          'allow_regression_by', 'admin_resume_council_deferred',
          'reset_reason', 'admin_resume_council_after_stale_pattern',
          'reset_at', now()::text,
          'council_defer_cleared', true
        ),
        updated_at = now()
    WHERE package_id = v_pkg
      AND step_key = 'quality_council'
      AND status::text IN ('failed', 'pending', 'pending_enqueue', 'skipped');

    SELECT id INTO v_existing FROM public.job_queue
    WHERE package_id = v_pkg AND job_type = 'package_quality_council'
      AND status IN ('pending','processing') LIMIT 1;

    v_action := 'resumed_existing_job';
    IF v_existing IS NULL THEN
      BEGIN
        PERFORM public.enqueue_job_if_absent(
          'package_quality_council'::text, v_pkg,
          jsonb_build_object('package_id', v_pkg, 'curriculum_id', v_curr, 'resumed_from_defer', true)
        );
        v_action := 'resumed_enqueued';
      EXCEPTION WHEN unique_violation THEN
        v_action := 'resumed_trigger_was_faster';
      END;
    END IF;

    v_per_pkg := v_per_pkg || jsonb_build_object(
      'package_id', v_pkg, 'curriculum_id', v_curr, 'action', v_action
    );
    v_total := v_total + 1;
  END LOOP;

  INSERT INTO public.admin_actions (user_id, action, payload, scope, affected_ids)
  VALUES (
    v_uid, 'admin_resume_council_deferred',
    jsonb_build_object('packages_resumed', v_total, 'packages_skipped_no_curriculum', v_skipped),
    'package', v_targets
  );

  RETURN jsonb_build_object(
    'ok', true, 'dry_run', false,
    'packages', v_total, 'skipped_no_curriculum', v_skipped,
    'per_package', v_per_pkg
  );
END;
$function$;

-- Manuelle Heilung der 3 Pakete aus den Screenshots
DO $$
DECLARE
  v_pkg uuid; v_curr uuid;
  v_pkgs uuid[] := ARRAY[
    'b77d271d-7815-4a5d-9643-7de31df83953'::uuid,
    '03287d1e-a4eb-4188-b65f-82eebf66dc82'::uuid,
    'bd19860b-7efb-46aa-b35e-708c0dc90b2c'::uuid
  ];
BEGIN
  FOREACH v_pkg IN ARRAY v_pkgs LOOP
    SELECT curriculum_id INTO v_curr FROM course_packages WHERE id = v_pkg;
    IF v_curr IS NULL THEN CONTINUE; END IF;

    UPDATE council_defer_log
    SET cleared_at = now(),
        meta = coalesce(meta, '{}'::jsonb) || jsonb_build_object('cleared_by','manual_heal_2026_04_27_v3')
    WHERE package_id = v_pkg AND cleared_at IS NULL;

    UPDATE package_steps
    SET status = 'queued', attempts = 0,
        meta = coalesce(meta, '{}'::jsonb) || jsonb_build_object(
          'allow_regression', true,
          'allow_regression_by', 'manual_heal_2026_04_27_v3',
          'reset_reason', 'admin_heal_curriculum_fix',
          'council_defer_cleared', true
        ),
        updated_at = now()
    WHERE package_id = v_pkg
      AND step_key = 'quality_council'
      AND status::text IN ('failed','pending','pending_enqueue','skipped');

    -- idempotent: nur wenn kein aktiver Job existiert
    IF NOT EXISTS (
      SELECT 1 FROM job_queue
      WHERE package_id = v_pkg AND job_type = 'package_quality_council'
        AND status IN ('pending','processing')
    ) THEN
      BEGIN
        PERFORM enqueue_job_if_absent(
          'package_quality_council'::text, v_pkg,
          jsonb_build_object('package_id', v_pkg, 'curriculum_id', v_curr, 'manual_heal', true)
        );
      EXCEPTION WHEN unique_violation THEN NULL;
      END;
    END IF;
  END LOOP;
END$$;