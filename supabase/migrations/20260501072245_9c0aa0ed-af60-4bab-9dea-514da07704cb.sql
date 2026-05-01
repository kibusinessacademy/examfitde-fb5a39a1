-- =====================================================================
-- HEAL v3 PATCH 3 (final) — Dedupe + Quarantine Hardening
-- =====================================================================

-- 0) Dedupe: behalte ältesten 'open' pro (pattern_key, package_id), Rest auf 'done'
WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY pattern_key, package_id
           ORDER BY created_at ASC, id ASC
         ) AS rn
  FROM public.heal_permanent_fix_tasks
  WHERE status = 'open' AND package_id IS NOT NULL
)
UPDATE public.heal_permanent_fix_tasks t
SET status = 'done',
    completed_at = now(),
    notes = COALESCE(t.notes,'') || E'\n[heal_v3_patch3] auto-merged duplicate'
FROM ranked r
WHERE t.id = r.id AND r.rn > 1;

-- 1) Partial-Unique-Index
CREATE UNIQUE INDEX IF NOT EXISTS uq_heal_permanent_fix_tasks_open_pkg_pattern
  ON public.heal_permanent_fix_tasks (pattern_key, package_id)
  WHERE status = 'open' AND package_id IS NOT NULL;

-- 2) fn_exam_pool_fallback_progress (Insert mit NOT EXISTS dedup)
CREATE OR REPLACE FUNCTION public.fn_exam_pool_fallback_progress(p_package_id uuid, p_failed boolean DEFAULT true)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_state exam_pool_fallback_state%ROWTYPE;
  v_new_stage text;
  v_new_count int;
  v_cancelled int := 0;
  v_exam_pool_types text[] := ARRAY[
    'package_generate_exam_pool','package_repair_exam_pool_quality',
    'package_validate_exam_pool','package_repair_exam_pool_competency_coverage',
    'package_repair_exam_pool_lf_coverage'
  ];
BEGIN
  IF NOT p_failed THEN RETURN jsonb_build_object('ok',true,'noop',true); END IF;

  SELECT * INTO v_state FROM exam_pool_fallback_state WHERE package_id = p_package_id;

  IF NOT FOUND THEN
    INSERT INTO exam_pool_fallback_state(package_id, fail_count_6h, current_stage, last_fail_at, last_stage_change_at)
    VALUES (p_package_id, 1, 'normal', now(), now())
    ON CONFLICT (package_id) DO UPDATE
      SET fail_count_6h = exam_pool_fallback_state.fail_count_6h + 1,
          last_fail_at = now(), updated_at = now()
    RETURNING * INTO v_state;
  ELSE
    v_new_count := COALESCE(v_state.fail_count_6h, 0) + 1;
    UPDATE exam_pool_fallback_state
    SET fail_count_6h = v_new_count, last_fail_at = now(), updated_at = now()
    WHERE package_id = p_package_id RETURNING * INTO v_state;
  END IF;

  v_new_stage := v_state.current_stage;
  IF v_state.fail_count_6h >= 8 AND v_state.current_stage <> 'paused' THEN
    v_new_stage := 'paused';
  ELSIF v_state.fail_count_6h >= 5 AND v_state.current_stage NOT IN ('paused','constraint_relax') THEN
    v_new_stage := 'constraint_relax';
  ELSIF v_state.fail_count_6h >= 3 AND v_state.current_stage = 'normal' THEN
    v_new_stage := 'provider_switch';
  END IF;

  IF v_new_stage <> v_state.current_stage THEN
    UPDATE exam_pool_fallback_state
    SET current_stage = v_new_stage, last_stage_change_at = now(), updated_at = now(),
        paused_reason = CASE WHEN v_new_stage='paused' THEN 'auto: 8+ fails in 6h' ELSE paused_reason END
    WHERE package_id = p_package_id;

    IF v_new_stage = 'paused' THEN
      UPDATE job_queue
      SET status='cancelled', last_error='AUTO_PAUSE: exam-pool fallback stage=paused after 8+ fails', updated_at=now()
      WHERE package_id = p_package_id AND job_type = ANY(v_exam_pool_types)
        AND status IN ('queued','processing','pending');
      GET DIAGNOSTICS v_cancelled = ROW_COUNT;

      IF NOT EXISTS (
        SELECT 1 FROM heal_permanent_fix_tasks
        WHERE pattern_key='exam_pool_paused' AND package_id=p_package_id AND status='open'
      ) THEN
        INSERT INTO heal_permanent_fix_tasks(pattern_key, cluster, package_id, title, description, status, priority)
        VALUES ('exam_pool_paused','exam_pool_loop',p_package_id,
          'AUTO-PAUSE: Exam-Pool nach 8+ Fails',
          'Auto-pause via fn_exam_pool_fallback_progress. Cancelled '||v_cancelled||' active jobs.',
          'open','critical');
      END IF;
    END IF;

    INSERT INTO auto_heal_log(action_type, trigger_source, target_type, target_id, result_status, result_detail, metadata)
    VALUES ('exam_pool_fallback_stage_change','fn_exam_pool_fallback_progress','course_package',p_package_id::text,
      'applied','Stage '||v_state.current_stage||' → '||v_new_stage,
      jsonb_build_object('old_stage',v_state.current_stage,'new_stage',v_new_stage,'fail_count',v_state.fail_count_6h,'cancelled_jobs',v_cancelled));
  END IF;

  RETURN jsonb_build_object('ok',true,'package_id',p_package_id,'stage',v_new_stage,'fail_count',v_state.fail_count_6h,'cancelled',v_cancelled);
END $$;

-- 3) RESTART vs UNPAUSE
DROP FUNCTION IF EXISTS public.admin_exam_pool_restart(uuid);

CREATE OR REPLACE FUNCTION public.admin_exam_pool_unpause(p_package_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF NOT has_role(v_uid, 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  UPDATE exam_pool_fallback_state
  SET current_stage='normal', fail_count_6h=0, model_override=NULL,
      constraint_overrides=NULL, last_stage_change_at=now(), updated_at=now(),
      paused_reason=NULL
  WHERE package_id = p_package_id;
  UPDATE heal_permanent_fix_tasks
  SET status='done', completed_at=now(), completed_by=v_uid,
      notes=COALESCE(notes,'')||E'\n[admin_exam_pool_unpause] '||now()::text
  WHERE package_id = p_package_id
    AND pattern_key IN ('exam_pool_paused','exam_pool_stagnation','exam_pool_quarantine')
    AND status='open';
  INSERT INTO auto_heal_log(action_type, trigger_source, target_type, target_id, result_status, result_detail, metadata)
  VALUES ('exam_pool_admin_unpause','admin_exam_pool_unpause','course_package',p_package_id::text,
    'applied','Admin reset exam-pool fallback to normal (no new job)',
    jsonb_build_object('admin_uid',v_uid));
  RETURN jsonb_build_object('ok',true,'action','unpause','package_id',p_package_id);
END $$;

CREATE OR REPLACE FUNCTION public.admin_exam_pool_restart(p_package_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_uid uuid := auth.uid(); v_job_id uuid;
BEGIN
  IF NOT has_role(v_uid, 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  PERFORM public.admin_exam_pool_unpause(p_package_id);

  UPDATE job_queue SET status='cancelled',
    last_error='ADMIN_RESTART: superseded by clean generate', updated_at=now()
  WHERE package_id = p_package_id
    AND job_type IN ('package_generate_exam_pool','package_repair_exam_pool_quality',
                     'package_validate_exam_pool','package_repair_exam_pool_competency_coverage',
                     'package_repair_exam_pool_lf_coverage')
    AND status IN ('queued','processing','pending');

  INSERT INTO job_queue(job_type, status, package_id, payload, run_after, attempts, max_attempts)
  VALUES ('package_generate_exam_pool','pending',p_package_id,
    jsonb_build_object('source','admin_exam_pool_restart','admin_uid',v_uid),
    now(), 0, 3)
  RETURNING id INTO v_job_id;

  INSERT INTO auto_heal_log(action_type, trigger_source, target_type, target_id, result_status, result_detail, metadata)
  VALUES ('exam_pool_admin_restart','admin_exam_pool_restart','course_package',p_package_id::text,
    'applied','Restart: unpause + clean generate job enqueued',
    jsonb_build_object('admin_uid',v_uid,'new_job_id',v_job_id));

  RETURN jsonb_build_object('ok',true,'action','restart','package_id',p_package_id,'new_job_id',v_job_id);
END $$;

REVOKE ALL ON FUNCTION public.admin_exam_pool_unpause(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_exam_pool_restart(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_exam_pool_unpause(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_exam_pool_restart(uuid) TO authenticated, service_role;

-- 4) STAGNATION-ALERT präziser
CREATE OR REPLACE FUNCTION public.fn_exam_pool_stagnation_alert()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_alerts_created int := 0;
  v_pkg record;
  v_exam_pool_types text[] := ARRAY[
    'package_generate_exam_pool','package_repair_exam_pool_quality',
    'package_validate_exam_pool','package_repair_exam_pool_competency_coverage',
    'package_repair_exam_pool_lf_coverage'
  ];
BEGIN
  FOR v_pkg IN
    WITH fail_burst AS (
      SELECT package_id, COUNT(*) AS metric, 'fail_burst_5_per_hour' AS pattern
      FROM job_queue
      WHERE job_type = ANY(v_exam_pool_types) AND status='failed'
        AND updated_at > now() - interval '1 hour' AND package_id IS NOT NULL
      GROUP BY package_id HAVING COUNT(*) >= 5
    ),
    proc_stagnation AS (
      SELECT package_id, COUNT(*) AS metric, 'processing_stalled_30min' AS pattern
      FROM job_queue
      WHERE job_type = ANY(v_exam_pool_types) AND status='processing'
        AND updated_at < now() - interval '30 minutes' AND package_id IS NOT NULL
      GROUP BY package_id
    ),
    queued_stuck AS (
      SELECT q.package_id, COUNT(*) AS metric, 'queued_overdue_no_active' AS pattern
      FROM job_queue q
      WHERE q.job_type = ANY(v_exam_pool_types) AND q.status='queued'
        AND q.updated_at < now() - interval '30 minutes'
        AND COALESCE(q.run_after, q.created_at) <= now()
        AND q.package_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM job_queue q2
          WHERE q2.package_id = q.package_id
            AND q2.status IN ('processing','pending')
            AND q2.id <> q.id
        )
      GROUP BY q.package_id
    )
    SELECT package_id, pattern, metric::int AS metric FROM fail_burst
    UNION ALL
    SELECT package_id, pattern, metric::int AS metric FROM proc_stagnation
    UNION ALL
    SELECT package_id, pattern, metric::int AS metric FROM queued_stuck
  LOOP
    IF EXISTS (
      SELECT 1 FROM heal_permanent_fix_tasks
      WHERE package_id = v_pkg.package_id
        AND pattern_key IN ('exam_pool_stagnation','exam_pool_paused','exam_pool_quarantine')
        AND status='open'
    ) THEN CONTINUE; END IF;

    INSERT INTO heal_permanent_fix_tasks(pattern_key, cluster, package_id, title, description, status, priority)
    VALUES ('exam_pool_stagnation','exam_pool_loop',v_pkg.package_id,
      'ALERT: Exam-Pool '||v_pkg.pattern||' (metric='||v_pkg.metric||')',
      'Pattern: '||v_pkg.pattern||' — Metric: '||v_pkg.metric||'. Quarantäne-View prüfen.',
      'open','critical');

    INSERT INTO auto_heal_log(action_type, trigger_source, target_type, target_id, result_status, result_detail, metadata)
    VALUES ('exam_pool_stagnation_alert','fn_exam_pool_stagnation_alert','course_package',v_pkg.package_id::text,
      'applied','Pattern: '||v_pkg.pattern||' metric='||v_pkg.metric,
      jsonb_build_object('pattern',v_pkg.pattern,'metric',v_pkg.metric,'severity','critical'));

    v_alerts_created := v_alerts_created + 1;
  END LOOP;

  RETURN jsonb_build_object('ok',true,'alerts_created',v_alerts_created,'ran_at',now());
END $$;

REVOKE ALL ON FUNCTION public.fn_exam_pool_stagnation_alert() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_exam_pool_stagnation_alert() TO service_role;

-- 5) v_admin_exam_pool_paused härten
REVOKE ALL ON public.v_admin_exam_pool_paused FROM authenticated, anon, PUBLIC;
GRANT SELECT ON public.v_admin_exam_pool_paused TO service_role;

CREATE OR REPLACE FUNCTION public.admin_get_exam_pool_paused()
RETURNS SETOF public.v_admin_exam_pool_paused
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT * FROM public.v_admin_exam_pool_paused;
END $$;

REVOKE ALL ON FUNCTION public.admin_get_exam_pool_paused() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_get_exam_pool_paused() TO authenticated, service_role;

-- 6) Quarantine-Insert dedup-safe
CREATE OR REPLACE FUNCTION public.admin_exam_pool_quarantine(p_package_id uuid, p_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_uid uuid := auth.uid(); v_cancelled int := 0; v_task_id uuid;
BEGIN
  IF NOT has_role(v_uid, 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  INSERT INTO exam_pool_fallback_state(package_id, fail_count_6h, current_stage, last_stage_change_at, updated_at, paused_reason)
  VALUES (p_package_id, 99, 'paused', now(), now(), COALESCE(p_reason,'admin_quarantine'))
  ON CONFLICT (package_id) DO UPDATE
    SET current_stage='paused', last_stage_change_at=now(), updated_at=now(),
        paused_reason=COALESCE(EXCLUDED.paused_reason,exam_pool_fallback_state.paused_reason);
  UPDATE job_queue SET status='cancelled',
    last_error='ADMIN_QUARANTINE: '||COALESCE(p_reason,'no reason'), updated_at=now()
  WHERE package_id = p_package_id
    AND job_type IN ('package_generate_exam_pool','package_repair_exam_pool_quality',
                     'package_validate_exam_pool','package_repair_exam_pool_competency_coverage',
                     'package_repair_exam_pool_lf_coverage')
    AND status IN ('queued','processing','pending');
  GET DIAGNOSTICS v_cancelled = ROW_COUNT;

  SELECT id INTO v_task_id
  FROM heal_permanent_fix_tasks
  WHERE pattern_key='exam_pool_quarantine' AND package_id=p_package_id AND status='open'
  LIMIT 1;

  IF v_task_id IS NULL THEN
    INSERT INTO heal_permanent_fix_tasks(pattern_key, cluster, package_id, title, description, status, priority, created_by)
    VALUES ('exam_pool_quarantine','exam_pool_loop',p_package_id,
      'Manuell quarantänt: Exam-Pool',
      COALESCE(p_reason,'Admin-Quarantäne')||E'\n['||v_cancelled||' Jobs cancelled]',
      'open','critical',v_uid)
    RETURNING id INTO v_task_id;
  ELSE
    UPDATE heal_permanent_fix_tasks
    SET notes = COALESCE(notes,'')||E'\n[re-quarantine '||now()::text||'] reason='||COALESCE(p_reason,'-')||' cancelled='||v_cancelled
    WHERE id = v_task_id;
  END IF;

  INSERT INTO auto_heal_log(action_type, trigger_source, target_type, target_id, result_status, result_detail, metadata)
  VALUES ('exam_pool_admin_quarantine','admin_exam_pool_quarantine','course_package',p_package_id::text,
    'applied','Quarantined: '||v_cancelled||' jobs cancelled',
    jsonb_build_object('admin_uid',v_uid,'cancelled',v_cancelled,'task_id',v_task_id,'reason',p_reason));
  RETURN jsonb_build_object('ok',true,'action','quarantine','cancelled',v_cancelled,'task_id',v_task_id);
END $$;
REVOKE ALL ON FUNCTION public.admin_exam_pool_quarantine(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_exam_pool_quarantine(uuid, text) TO authenticated, service_role;
