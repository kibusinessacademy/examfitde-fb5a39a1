CREATE OR REPLACE FUNCTION public.admin_reconcile_coverage_met_integrity_false(
  p_limit int DEFAULT 10,
  p_dry_run boolean DEFAULT true,
  p_wip_cap int DEFAULT 20
)
RETURNS TABLE(
  package_id uuid,
  package_key text,
  title text,
  track text,
  coverage numeric,
  min_coverage numeric,
  action_taken text,
  reason text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_caller uuid := auth.uid();
  rec RECORD;
  v_active_integrity int;
  v_remaining_cap int;
  v_enq int := 0;
  v_skipped int := 0;
  v_cooldown int := 0;
BEGIN
  IF v_caller IS NOT NULL AND NOT public.has_role(v_caller, 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden: admin role required' USING ERRCODE='42501';
  END IF;

  SELECT COUNT(*) INTO v_active_integrity
  FROM job_queue
  WHERE job_type='package_run_integrity_check'
    AND status IN ('pending','processing','queued','retry_scheduled','batch_pending');

  v_remaining_cap := GREATEST(0, p_wip_cap - v_active_integrity);

  FOR rec IN
    SELECT cp.id, cp.package_key, cp.title, cp.track::text AS track_text, cp.curriculum_id,
           cov.competency_question_coverage_pct AS coverage,
           thr.min_competency_question_coverage_pct AS min_coverage
    FROM course_packages cp
    LEFT JOIN LATERAL public.fn_compute_package_coverage(cp.id) cov ON true
    LEFT JOIN LATERAL public.fn_track_min_coverage_thresholds(cp.track::text) thr ON true
    WHERE cp.status='building'
      AND COALESCE(cp.archived,false)=false
      AND COALESCE((cp.feature_flags->>'admin_terminal')::boolean, false) = false
      AND cov.competency_question_coverage_pct >= thr.min_competency_question_coverage_pct
      AND COALESCE(cp.integrity_passed,false)=false
      AND NOT EXISTS (
        SELECT 1 FROM job_queue jq
        WHERE jq.package_id=cp.id
          AND jq.job_type='package_run_integrity_check'
          AND jq.status IN ('pending','processing','queued','retry_scheduled','batch_pending')
      )
    ORDER BY (cov.competency_question_coverage_pct - thr.min_competency_question_coverage_pct) DESC, cp.updated_at ASC
    LIMIT p_limit
  LOOP
    package_id := rec.id;
    package_key := rec.package_key;
    title := rec.title;
    track := rec.track_text;
    coverage := rec.coverage;
    min_coverage := rec.min_coverage;

    IF NOT p_dry_run AND v_remaining_cap <= 0 THEN
      action_taken := 'SKIPPED';
      reason := 'wip_cap_exhausted';
      v_skipped := v_skipped + 1;
      RETURN NEXT;
      CONTINUE;
    END IF;

    IF NOT p_dry_run AND public.fn_tail_heal_package_cooldown_active(rec.id, interval '5 minutes') THEN
      action_taken := 'SKIPPED';
      reason := 'cooldown_5min';
      v_cooldown := v_cooldown + 1;
      INSERT INTO auto_heal_log(action_type, target_type, target_id, result_status, metadata)
      VALUES ('coverage_met_integrity_reconcile_skipped','package',rec.id::text,'skipped',
        jsonb_build_object('reason','cooldown_5min','package_key',rec.package_key));
      RETURN NEXT;
      CONTINUE;
    END IF;

    IF p_dry_run THEN
      action_taken := 'DRY_RUN_WOULD_ENQUEUE';
      reason := 'eligible';
      RETURN NEXT;
      CONTINUE;
    END IF;

    BEGIN
      INSERT INTO job_queue (job_type, status, package_id, payload, priority, worker_pool, job_name)
      VALUES (
        'package_run_integrity_check','pending', rec.id,
        jsonb_build_object(
          'package_id', rec.id,
          'curriculum_id', rec.curriculum_id,
          'enqueue_source','bulk_coverage_met_integrity_reconcile',
          'step_key','run_integrity_check',
          'bronze_lock_override', true,
          'reason','coverage_met_integrity_stale_false'
        ),
        5, 'core', 'package_run_integrity_check'
      );

      INSERT INTO auto_heal_log(action_type, target_type, target_id, result_status, metadata)
      VALUES ('coverage_met_integrity_reconcile_enqueued','package',rec.id::text,'success',
        jsonb_build_object(
          'package_key', rec.package_key,
          'track', rec.track_text,
          'coverage', rec.coverage,
          'min_coverage', rec.min_coverage,
          'bronze_lock_override', true
        ));

      v_enq := v_enq + 1;
      v_remaining_cap := v_remaining_cap - 1;
      action_taken := 'ENQUEUED';
      reason := 'eligible';
      RETURN NEXT;
    EXCEPTION WHEN OTHERS THEN
      v_skipped := v_skipped + 1;
      action_taken := 'ERROR';
      reason := SQLERRM;
      INSERT INTO auto_heal_log(action_type, target_type, target_id, result_status, error_message, metadata)
      VALUES ('coverage_met_integrity_reconcile_error','package',rec.id::text,'failed',SQLERRM,
        jsonb_build_object('package_key', rec.package_key));
      RETURN NEXT;
    END;
  END LOOP;

  INSERT INTO auto_heal_log(action_type, target_type, target_id, result_status, metadata)
  VALUES ('coverage_met_integrity_reconcile_summary','system',NULL,'success',
    jsonb_build_object(
      'dry_run', p_dry_run,
      'enqueued', v_enq,
      'skipped', v_skipped,
      'cooldown_skipped', v_cooldown,
      'wip_cap', p_wip_cap,
      'active_integrity_at_start', v_active_integrity,
      'limit', p_limit
    ));
END $$;

REVOKE ALL ON FUNCTION public.admin_reconcile_coverage_met_integrity_false(int,boolean,int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_reconcile_coverage_met_integrity_false(int,boolean,int) TO service_role;