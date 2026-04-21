
DO $$
DECLARE
  v_pkg uuid;
  v_active_bp int;
  v_has_finished bool;
  v_steps_done int := 0;
  v_jobs_cancelled int := 0;
  v_poison_parked int := 0;
  v_affected_pkgs uuid[] := ARRAY[]::uuid[];
  r record;
BEGIN
  -- Step 1: Force-Done via SSOT-Bypass für jedes evidenzbasierte Paket
  FOR r IN
    SELECT ps.package_id,
           ps.finished_at IS NOT NULL AS has_finished_at,
           (SELECT COUNT(*) FROM public.question_blueprints qb 
            JOIN public.course_packages cp ON cp.id = ps.package_id
            WHERE qb.curriculum_id = cp.curriculum_id) AS active_bp
    FROM public.package_steps ps
    WHERE ps.step_key = 'auto_seed_exam_blueprints'
      AND ps.status = 'queued'
  LOOP
    IF r.active_bp > 0 THEN
      BEGIN
        PERFORM public.admin_force_steps_done(
          r.package_id,
          ARRAY['auto_seed_exam_blueprints']::text[],
          format('ops_seed_zombie_recovery: active_blueprints=%s, finished_at_present=%s', r.active_bp, r.has_finished_at),
          true,   -- emergency_bypass
          false   -- force_publish
        );
        v_steps_done := v_steps_done + 1;
        v_affected_pkgs := v_affected_pkgs || r.package_id;
      EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'Failed to force-done package %: %', r.package_id, SQLERRM;
      END;
    END IF;
  END LOOP;

  -- Step 2: Cancel obsolete Seed-Jobs für dieselben Pakete
  WITH cj AS (
    UPDATE public.job_queue
    SET status = 'cancelled',
        meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
          'cancel_reason', 'step_finalized_job_obsoleted',
          'cancel_source', 'ops_seed_zombie_recovery',
          'cancelled_at', now()::text
        ),
        updated_at = now()
    WHERE job_type = 'package_auto_seed_exam_blueprints'
      AND package_id = ANY(v_affected_pkgs)
      AND status IN ('pending','queued','enqueued','batch_pending','processing','running','pending_enqueue')
    RETURNING id
  )
  SELECT COUNT(*) INTO v_jobs_cancelled FROM cj;

  -- Step 3: Park Poison exam_pool Jobs
  WITH pj AS (
    UPDATE public.job_queue
    SET status = 'cancelled',
        meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
          'cancel_reason', 'poison_loop_parked',
          'cancel_source', 'ops_seed_zombie_recovery',
          'parked_at_attempts', attempts,
          'parked_at', now()::text,
          'manual_review_required', true
        ),
        updated_at = now()
    WHERE job_type = 'package_generate_exam_pool'
      AND attempts >= 5
      AND status IN ('pending','queued','running','pending_enqueue')
      AND (last_error ILIKE '%PREREQ_NOT_DONE%' OR last_error ILIKE '%NO_BLUEPRINTS%')
    RETURNING id
  )
  SELECT COUNT(*) INTO v_poison_parked FROM pj;

  -- Audit
  INSERT INTO public.admin_actions (action, scope, payload, affected_ids)
  VALUES (
    'ops_seed_zombie_recovery',
    'package_steps+job_queue',
    jsonb_build_object(
      'steps_force_done', v_steps_done,
      'seed_jobs_cancelled', v_jobs_cancelled,
      'poison_exam_pool_parked', v_poison_parked,
      'evidence_basis', 'active_question_blueprints>0 for matching curriculum',
      'method', 'admin_force_steps_done with emergency_bypass=true'
    ),
    (SELECT array_agg(p::text) FROM unnest(v_affected_pkgs) p)
  );

  RAISE NOTICE 'Recovery: % steps done, % seed jobs cancelled, % poison parked', 
    v_steps_done, v_jobs_cancelled, v_poison_parked;
END $$;
