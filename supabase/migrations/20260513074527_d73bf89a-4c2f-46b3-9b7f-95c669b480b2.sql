
DROP FUNCTION IF EXISTS public.admin_reconcile_bronze_no_report(integer, boolean);

CREATE OR REPLACE FUNCTION public.admin_reconcile_bronze_no_report(
  p_limit   integer DEFAULT 3,
  p_dry_run boolean DEFAULT true
)
RETURNS TABLE(
  package_id   uuid,
  package_key  text,
  approved_q   integer,
  action_taken text,
  reason       text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
#variable_conflict use_column
DECLARE
  v_caller   uuid := auth.uid();
  v_is_admin boolean;
  rec        record;
  v_approved int;
  v_active   int;
  v_enqueued int := 0;
  v_skipped  int := 0;
  v_dryrun   int := 0;
  v_errors   int := 0;
  v_run_id   uuid := gen_random_uuid();
BEGIN
  IF v_caller IS NULL THEN
    v_is_admin := true;
  ELSE
    SELECT public.has_role(v_caller, 'admin'::app_role) INTO v_is_admin;
    IF NOT COALESCE(v_is_admin, false) THEN
      RAISE EXCEPTION 'forbidden: admin role required';
    END IF;
  END IF;

  FOR rec IN
    SELECT prg.package_id AS pkg_id, cp.package_key AS pkg_key, cp.curriculum_id AS curr_id,
           prg.score AS pscore
    FROM public.v_publish_readiness_gate prg
    JOIN public.course_packages cp ON cp.id = prg.package_id
    WHERE prg.gate_class = 'BRONZE_REVIEW_REQUIRED'
      AND COALESCE(prg.score, 0) = 0
      AND (prg.hard_fail_reasons IS NULL
           OR prg.hard_fail_reasons = '[]'::jsonb
           OR jsonb_array_length(prg.hard_fail_reasons) = 0)
    ORDER BY cp.updated_at DESC
    LIMIT GREATEST(p_limit, 0) * 4 + 10
  LOOP
    SELECT COUNT(*) INTO v_approved
    FROM public.exam_questions eq
    WHERE eq.package_id = rec.pkg_id
      AND eq.status = 'approved';

    IF v_approved < 50 THEN
      v_skipped := v_skipped + 1;
      INSERT INTO public.auto_heal_log(target_id, target_type, action_type, result_status, metadata)
      VALUES (rec.pkg_id::text, 'package',
              'bronze_no_report_reconcile_skipped', 'skipped',
              jsonb_build_object('package_id', rec.pkg_id, 'package_key', rec.pkg_key,
                                 'reason','approved_lt_50','approved_q', v_approved,
                                 'run_id', v_run_id, 'dry_run', p_dry_run));
      package_id := rec.pkg_id; package_key := rec.pkg_key;
      approved_q := v_approved; action_taken := 'SKIPPED'; reason := 'approved_lt_50';
      RETURN NEXT; CONTINUE;
    END IF;

    SELECT COUNT(*) INTO v_active
    FROM public.job_queue jq
    WHERE jq.package_id = rec.pkg_id
      AND jq.job_type = 'package_run_integrity_check'
      AND jq.status IN ('pending','processing');

    IF v_active > 0 THEN
      v_skipped := v_skipped + 1;
      INSERT INTO public.auto_heal_log(target_id, target_type, action_type, result_status, metadata)
      VALUES (rec.pkg_id::text, 'package',
              'bronze_no_report_reconcile_skipped', 'skipped',
              jsonb_build_object('package_id', rec.pkg_id, 'package_key', rec.pkg_key,
                                 'reason','active_integrity_job_present','active_jobs', v_active,
                                 'run_id', v_run_id, 'dry_run', p_dry_run));
      package_id := rec.pkg_id; package_key := rec.pkg_key;
      approved_q := v_approved; action_taken := 'SKIPPED'; reason := 'active_integrity_job';
      RETURN NEXT; CONTINUE;
    END IF;

    IF p_dry_run THEN
      v_dryrun := v_dryrun + 1;
      INSERT INTO public.auto_heal_log(target_id, target_type, action_type, result_status, metadata)
      VALUES (rec.pkg_id::text, 'package',
              'bronze_no_report_reconcile_dryrun', 'success',
              jsonb_build_object('package_id', rec.pkg_id, 'package_key', rec.pkg_key,
                                 'approved_q', v_approved, 'curriculum_id', rec.curr_id,
                                 'run_id', v_run_id, 'would_enqueue','package_run_integrity_check',
                                 'bronze_lock_override', true));
      package_id := rec.pkg_id; package_key := rec.pkg_key;
      approved_q := v_approved; action_taken := 'DRY_RUN_WOULD_ENQUEUE'; reason := 'bronze_no_report';
      RETURN NEXT;
    ELSE
      BEGIN
        INSERT INTO public.job_queue (job_type, status, package_id, payload, priority, worker_pool, job_name)
        VALUES ('package_run_integrity_check','pending', rec.pkg_id,
                jsonb_build_object('package_id', rec.pkg_id, 'curriculum_id', rec.curr_id,
                                   'enqueue_source','admin_reconcile_bronze_no_report',
                                   'step_key','run_integrity_check',
                                   'bronze_lock_override', true,
                                   'reason','bronze_no_report','run_id', v_run_id),
                5, 'core','package_run_integrity_check');

        INSERT INTO public.auto_heal_log(target_id, target_type, action_type, result_status, metadata)
        VALUES (rec.pkg_id::text, 'package',
                'bronze_no_report_reconcile_enqueued', 'success',
                jsonb_build_object('package_id', rec.pkg_id, 'package_key', rec.pkg_key,
                                   'approved_q', v_approved, 'curriculum_id', rec.curr_id,
                                   'run_id', v_run_id, 'enqueued','package_run_integrity_check',
                                   'bronze_lock_override', true));
        v_enqueued := v_enqueued + 1;
        package_id := rec.pkg_id; package_key := rec.pkg_key;
        approved_q := v_approved; action_taken := 'ENQUEUED'; reason := 'bronze_no_report';
        RETURN NEXT;
      EXCEPTION WHEN OTHERS THEN
        v_errors := v_errors + 1;
        INSERT INTO public.auto_heal_log(target_id, target_type, action_type, result_status, error_message, metadata)
        VALUES (rec.pkg_id::text, 'package',
                'bronze_no_report_reconcile_error', 'failed', SQLERRM,
                jsonb_build_object('package_id', rec.pkg_id, 'package_key', rec.pkg_key,
                                   'sqlstate', SQLSTATE, 'run_id', v_run_id));
        package_id := rec.pkg_id; package_key := rec.pkg_key;
        approved_q := v_approved; action_taken := 'ERROR'; reason := SQLERRM;
        RETURN NEXT;
      END;
    END IF;

    EXIT WHEN (v_enqueued + v_dryrun) >= GREATEST(p_limit, 0);
  END LOOP;

  INSERT INTO public.auto_heal_log(target_id, target_type, action_type, result_status, metadata)
  VALUES (NULL, 'system',
          'bronze_no_report_reconcile_summary',
          CASE WHEN v_errors > 0 THEN 'partial' ELSE 'success' END,
          jsonb_build_object('run_id', v_run_id, 'dry_run', p_dry_run, 'p_limit', p_limit,
                             'enqueued', v_enqueued, 'dry_run_count', v_dryrun,
                             'skipped', v_skipped, 'errors', v_errors));

  RETURN;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_reconcile_bronze_no_report(integer, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_reconcile_bronze_no_report(integer, boolean) TO service_role;

COMMENT ON FUNCTION public.admin_reconcile_bronze_no_report(integer, boolean) IS
'Bucket-C Heal: queued Bronze-Pakete mit fehlendem Integrity-Report (score=0, hard_fails=[], approved>=50, kein aktiver integrity-Job) re-enqueuen. Audit: bronze_no_report_reconcile_{dryrun,enqueued,skipped,error,summary}. Default p_dry_run=true.';
