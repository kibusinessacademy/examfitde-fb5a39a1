-- (1) Terminal-Kill RPC
CREATE OR REPLACE FUNCTION public.admin_terminal_kill_requeue_loop_jobs(
  p_job_type text DEFAULT 'package_auto_publish',
  p_error_pattern text DEFAULT 'REQUEUE_LOOP%',
  p_min_attempts int DEFAULT 3,
  p_dry_run boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_killed jsonb := '[]'::jsonb;
  v_n int := 0;
  r record;
BEGIN
  IF NOT (has_role(auth.uid(), 'admin'::app_role)
          OR current_setting('role', true) = 'service_role'
          OR session_user IN ('postgres','supabase_admin')) THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: admin role required';
  END IF;

  FOR r IN
    SELECT id, package_id, attempts, last_error
      FROM job_queue
     WHERE job_type = p_job_type
       AND status IN ('pending','processing')
       AND last_error LIKE p_error_pattern
       AND attempts >= p_min_attempts
     FOR UPDATE SKIP LOCKED
  LOOP
    IF NOT p_dry_run THEN
      UPDATE job_queue
         SET status='cancelled', completed_at=now(), updated_at=now(),
             last_error = COALESCE(last_error,'')||' | TERMINAL_KILL_REQUEUE_LOOP_MANUAL',
             meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object(
               'terminal_kill_at', now(),
               'terminal_kill_reason','manual_sustainable_heal_requeue_loop')
       WHERE id = r.id;
      INSERT INTO auto_heal_log (trigger_source, action_type, target_id, target_type, result_status, result_detail, input_params, metadata)
      VALUES ('manual:admin_terminal_kill_requeue_loop_jobs','requeue_loop_terminal_kill',
              r.id::text,'job','success',
              format('Cancelled %s job %s (pkg=%s, attempts=%s)', p_job_type, r.id, r.package_id, r.attempts),
              jsonb_build_object('job_type', p_job_type, 'pattern', p_error_pattern, 'min_attempts', p_min_attempts),
              jsonb_build_object('package_id', r.package_id, 'attempts', r.attempts, 'last_error', r.last_error));
    END IF;
    v_killed := v_killed || jsonb_build_object('id', r.id, 'package_id', r.package_id, 'attempts', r.attempts);
    v_n := v_n + 1;
  END LOOP;

  RETURN jsonb_build_object('killed', v_n, 'dry_run', p_dry_run, 'jobs', v_killed);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_terminal_kill_requeue_loop_jobs(text,text,int,boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_terminal_kill_requeue_loop_jobs(text,text,int,boolean) TO service_role, authenticated;

-- (2) Inline kill + bronze repair dispatch (migration runs as postgres → bypass)
DO $$
DECLARE
  r record; v jsonb; pkg_ids uuid[];
BEGIN
  -- Collect affected package_ids first
  SELECT array_agg(DISTINCT package_id) INTO pkg_ids
    FROM job_queue
   WHERE job_type='package_auto_publish'
     AND status IN ('pending','processing')
     AND last_error LIKE '%REQUEUE_LOOP%'
     AND attempts >= 3;

  -- Cancel jobs
  FOR r IN
    SELECT id, package_id, attempts, last_error
      FROM job_queue
     WHERE job_type='package_auto_publish'
       AND status IN ('pending','processing')
       AND last_error LIKE '%REQUEUE_LOOP%'
       AND attempts >= 3
     FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE job_queue
       SET status='cancelled', completed_at=now(), updated_at=now(),
           last_error=COALESCE(last_error,'')||' | TERMINAL_KILL_REQUEUE_LOOP_MIGRATION',
           meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object(
             'terminal_kill_at', now(),
             'terminal_kill_reason','manual_sustainable_heal_requeue_loop_2026_05_09')
     WHERE id = r.id;
    INSERT INTO auto_heal_log (trigger_source, action_type, target_id, target_type, result_status, result_detail, metadata)
    VALUES ('migration:requeue_loop_terminal_2026_05_09','requeue_loop_terminal_kill',
            r.id::text,'job','success',
            format('Cancelled job %s pkg=%s attempts=%s', r.id, r.package_id, r.attempts),
            jsonb_build_object('package_id', r.package_id, 'attempts', r.attempts, 'last_error', r.last_error));
  END LOOP;

  -- Lock packages bronze + dispatch repair
  IF pkg_ids IS NOT NULL THEN
    FOR r IN
      SELECT cp.id FROM course_packages cp
       JOIN package_steps ps ON ps.package_id=cp.id AND ps.step_key='quality_council'
       WHERE cp.id = ANY(pkg_ids) AND ps.meta->>'badge'='bronze'
    LOOP
      UPDATE course_packages
         SET feature_flags = jsonb_set(
               COALESCE(feature_flags,'{}'::jsonb),'{bronze}',
               COALESCE(feature_flags->'bronze','{}'::jsonb) || jsonb_build_object(
                 'manual_bypass', true,
                 'manual_bypass_at', now(),
                 'manual_bypass_reason','requeue_loop_terminal_2026_05_09',
                 'requires_review', true), true)
       WHERE id = r.id;
      BEGIN
        v := public.admin_bronze_targeted_repair_dispatch(r.id);
        INSERT INTO auto_heal_log (trigger_source, action_type, target_id, target_type, result_status, result_detail, metadata)
        VALUES ('migration:requeue_loop_terminal_2026_05_09','bronze_repair_dispatched_after_kill',
                r.id::text,'package','success', v::text, v);
      EXCEPTION WHEN OTHERS THEN
        INSERT INTO auto_heal_log (trigger_source, action_type, target_id, target_type, result_status, error_message)
        VALUES ('migration:requeue_loop_terminal_2026_05_09','bronze_repair_dispatched_after_kill',
                r.id::text,'package','error', SQLERRM);
      END;
    END LOOP;
  END IF;
END $$;

-- (3) Nightly Contract Drift Audit
CREATE OR REPLACE FUNCTION public.fn_nightly_contract_drift_audit()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_known_steps text[];
  v_known_jobs  text[];
  v_known_actions text[] := ARRAY[
    'repair_lf_coverage','repair_exam_pool_quality','repair_exam_pool_competency_coverage',
    'repair_lessons','repair_handbook','repair_oral_exam','repair_minichecks',
    'enqueue_lf_coverage_repair',
    'guided_recovery','mark_content_gap','needs_repair_dispatch','force_publish',
    'bulk_reconcile','awaiting_pipeline','monitor','hard_rebuild','wave_revoke',
    'package_generate_exam_pool','package_repair_exam_pool_lf_coverage',
    'package_repair_exam_pool_competency_coverage'
  ];
  v_orphan_jobs int := 0;
  v_invalid_steps int := 0;
  v_unknown_actions int := 0;
  v_summary jsonb;
  r record;
BEGIN
  SELECT ARRAY(SELECT DISTINCT step_key FROM step_dag_edges
               UNION SELECT DISTINCT depends_on FROM step_dag_edges WHERE depends_on IS NOT NULL)
    INTO v_known_steps;
  SELECT ARRAY(SELECT DISTINCT job_type FROM ops_job_type_registry) INTO v_known_jobs;

  FOR r IN
    SELECT job_type, COUNT(*) AS n FROM job_queue
     WHERE created_at > now() - interval '7 days'
       AND NOT (job_type = ANY(v_known_jobs))
     GROUP BY job_type
  LOOP
    v_orphan_jobs := v_orphan_jobs + 1;
    INSERT INTO auto_heal_log (trigger_source, action_type, target_id, target_type, result_status, result_detail, metadata)
    VALUES ('cron:nightly_drift_audit','contract_drift_detected',
            r.job_type,'job_type','warn',
            format('Orphan job_type %s used %s× last 7d', r.job_type, r.n),
            jsonb_build_object('drift_class','orphan_job_type','job_type', r.job_type, 'count_7d', r.n));
  END LOOP;

  FOR r IN
    SELECT step_key, COUNT(*) AS n FROM package_steps
     WHERE NOT (step_key = ANY(v_known_steps))
     GROUP BY step_key
  LOOP
    v_invalid_steps := v_invalid_steps + 1;
    INSERT INTO auto_heal_log (trigger_source, action_type, target_id, target_type, result_status, result_detail, metadata)
    VALUES ('cron:nightly_drift_audit','contract_drift_detected',
            r.step_key,'step_key','warn',
            format('Invalid step_key %s in %s rows', r.step_key, r.n),
            jsonb_build_object('drift_class','invalid_step_key','step_key', r.step_key, 'count', r.n));
  END LOOP;

  FOR r IN
    SELECT COALESCE(payload->>'action', payload->>'recommended_action') AS action_value, COUNT(*) AS n
      FROM job_queue
     WHERE created_at > now() - interval '7 days'
       AND (payload ? 'action' OR payload ? 'recommended_action')
     GROUP BY 1
  LOOP
    IF r.action_value IS NULL THEN CONTINUE; END IF;
    IF r.action_value = ANY(v_known_actions) THEN CONTINUE; END IF;
    v_unknown_actions := v_unknown_actions + 1;
    INSERT INTO auto_heal_log (trigger_source, action_type, target_id, target_type, result_status, result_detail, metadata)
    VALUES ('cron:nightly_drift_audit','contract_drift_detected',
            r.action_value,'action','warn',
            format('Unknown action %s used %s× last 7d', r.action_value, r.n),
            jsonb_build_object('drift_class','unknown_action','action', r.action_value, 'count_7d', r.n));
  END LOOP;

  v_summary := jsonb_build_object('ran_at', now(),
    'orphan_job_types', v_orphan_jobs,
    'invalid_step_keys', v_invalid_steps,
    'unknown_actions', v_unknown_actions);

  INSERT INTO auto_heal_log (trigger_source, action_type, target_id, target_type, result_status, result_detail, metadata)
  VALUES ('cron:nightly_drift_audit','contract_drift_audit_run','system','system',
          CASE WHEN (v_orphan_jobs+v_invalid_steps+v_unknown_actions)=0 THEN 'success' ELSE 'warn' END,
          v_summary::text, v_summary);
  RETURN v_summary;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_nightly_contract_drift_audit() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_nightly_contract_drift_audit() TO service_role;

-- (4) Schedule nightly cron (03:33 UTC). pg_cron is project-installed; safe to call directly.
DO $$
BEGIN
  PERFORM cron.unschedule('nightly-contract-drift-audit');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'nightly-contract-drift-audit',
  '33 3 * * *',
  $cron$ SELECT public.fn_nightly_contract_drift_audit(); $cron$
);