-- ============================================================
-- A) MANUAL BRONZE TARGETED REPAIR (75–84 packages, inline)
-- ============================================================
DO $$
DECLARE r record; v_attempts int; v_curr uuid; v_id uuid;
BEGIN
  PERFORM set_config('app.transition_source','admin_manual_bypass:bronze_repair_2026_05_07',true);

  FOR r IN
    SELECT DISTINCT ON (j.package_id) j.package_id,
           substring(j.last_error from 'integrity_score=([0-9]+)')::int AS score
    FROM job_queue j
    WHERE j.status='failed' AND j.last_error LIKE 'QUALITY_THRESHOLD_NOT_MET%'
      AND j.updated_at > now() - interval '2 hours'
    ORDER BY j.package_id, j.updated_at DESC
  LOOP
    CONTINUE WHEN r.score IS NULL OR r.score < 75 OR r.score > 84;

    SELECT cp.curriculum_id, COALESCE((cp.feature_flags->'bronze'->>'repair_attempts')::int,0)
      INTO v_curr, v_attempts
      FROM course_packages cp WHERE cp.id = r.package_id;

    IF v_attempts >= 1 THEN
      UPDATE course_packages
         SET feature_flags = jsonb_set(COALESCE(feature_flags,'{}'::jsonb), '{bronze}',
               COALESCE(feature_flags->'bronze','{}'::jsonb) || jsonb_build_object(
                 'requires_review', true, 'final_state','requires_review',
                 'final_state_at', now(), 'last_score', r.score), true)
       WHERE id = r.package_id;
      INSERT INTO auto_heal_log (action_type, target_type, target_id, result_status, metadata)
      VALUES ('manual_bronze_terminal_review','package', r.package_id, 'success',
              jsonb_build_object('score', r.score, 'attempts', v_attempts));
      CONTINUE;
    END IF;

    UPDATE course_packages
       SET feature_flags = jsonb_set(COALESCE(feature_flags,'{}'::jsonb), '{bronze}',
             COALESCE(feature_flags->'bronze','{}'::jsonb) || jsonb_build_object(
               'repair_active', true, 'repair_attempts', v_attempts + 1,
               'last_score', r.score, 'manual_dispatch_at', now()), true)
     WHERE id = r.package_id;

    BEGIN
      INSERT INTO job_queue (job_type, package_id, status, priority, payload, meta, enqueue_source, idempotency_key)
      VALUES ('package_elite_harden', r.package_id, 'queued', 7,
        jsonb_build_object('package_id', r.package_id, 'curriculum_id', v_curr,
          'bronze_lock_override', true, 'enqueue_source','bronze_targeted_repair',
          'origin_council_score', r.score, 'bronze_attempt', v_attempts + 1),
        jsonb_build_object('bronze_repair', true, 'manual_bypass', true),
        'bronze_targeted_repair',
        'manual_bronze_repair:'||r.package_id::text||':'||(v_attempts+1)::text)
      RETURNING id INTO v_id;

      INSERT INTO auto_heal_log (action_type, target_type, target_id, result_status, metadata)
      VALUES ('manual_bronze_targeted_repair','package', r.package_id, 'success',
              jsonb_build_object('score', r.score,'job_id', v_id, 'attempt', v_attempts + 1));
    EXCEPTION WHEN others THEN
      INSERT INTO auto_heal_log (action_type, target_type, target_id, result_status, metadata)
      VALUES ('manual_bronze_targeted_repair','package', r.package_id, 'failed',
              jsonb_build_object('error', SQLERRM, 'score', r.score));
    END;
  END LOOP;
END $$;

-- ============================================================
-- B) TREND/HISTORY: Snapshot-Tabelle + Cron-Funktion
-- ============================================================
CREATE TABLE IF NOT EXISTS public.dag_blocked_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  captured_at timestamptz NOT NULL DEFAULT now(),
  total int NOT NULL DEFAULT 0,
  by_reason jsonb NOT NULL DEFAULT '{}'::jsonb,
  by_package jsonb NOT NULL DEFAULT '[]'::jsonb,
  oldest_minutes numeric,
  severity text
);
ALTER TABLE public.dag_blocked_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS dag_history_admin_select ON public.dag_blocked_history;
CREATE POLICY dag_history_admin_select ON public.dag_blocked_history
  FOR SELECT TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));
CREATE INDEX IF NOT EXISTS idx_dag_blocked_history_captured ON public.dag_blocked_history(captured_at DESC);

CREATE OR REPLACE FUNCTION public.fn_snapshot_dag_blocked()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_total int; v_by_reason jsonb; v_by_pkg jsonb; v_oldest numeric; v_sev text;
BEGIN
  SELECT COUNT(*), COALESCE(jsonb_object_agg(block_reason, c),'{}'::jsonb)
    INTO v_total, v_by_reason
    FROM (
      SELECT block_reason, COUNT(*) AS c FROM v_dag_blocked_jobs GROUP BY block_reason
    ) x;
  SELECT MAX(minutes_blocked) INTO v_oldest FROM v_dag_blocked_jobs;
  v_sev := CASE WHEN v_total >= 50 THEN 'P0' WHEN v_total >= 20 THEN 'P1' WHEN v_total >= 5 THEN 'P2' ELSE 'OK' END;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'package_id', package_id, 'package_title', package_title, 'blocked_jobs', n)),'[]'::jsonb)
    INTO v_by_pkg
    FROM (
      SELECT package_id, MAX(package_title) AS package_title, COUNT(*) AS n
      FROM v_dag_blocked_jobs GROUP BY package_id ORDER BY COUNT(*) DESC LIMIT 25
    ) p;
  INSERT INTO dag_blocked_history (total, by_reason, by_package, oldest_minutes, severity)
  VALUES (COALESCE(v_total,0), v_by_reason, v_by_pkg, v_oldest, v_sev);
END $$;

CREATE OR REPLACE FUNCTION public.admin_get_dag_blocked_history(p_hours int DEFAULT 24)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public STABLE AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL OR NOT has_role(v_uid,'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='42501';
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'captured_at', captured_at, 'total', total, 'severity', severity,
      'by_reason', by_reason, 'oldest_minutes', oldest_minutes
    ) ORDER BY captured_at)
    FROM dag_blocked_history WHERE captured_at > now() - make_interval(hours=>p_hours)
  ),'[]'::jsonb);
END $$;
GRANT EXECUTE ON FUNCTION public.admin_get_dag_blocked_history(int) TO authenticated;

-- Drilldown RPC for one job
CREATE OR REPLACE FUNCTION public.admin_get_dag_blocked_drilldown(p_job_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public STABLE AS $$
DECLARE v_uid uuid := auth.uid(); v_row record; v_log jsonb; v_parent jsonb;
BEGIN
  IF v_uid IS NULL OR NOT has_role(v_uid,'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='42501';
  END IF;
  SELECT * INTO v_row FROM v_dag_blocked_jobs WHERE job_id = p_job_id LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','not_found'); END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'created_at', created_at, 'action_type', action_type,
    'result_status', result_status, 'metadata', metadata
  ) ORDER BY created_at DESC),'[]'::jsonb) INTO v_log
    FROM auto_heal_log
   WHERE target_id = v_row.package_id::text
     AND created_at > now() - interval '7 days'
   LIMIT 20;

  SELECT jsonb_build_object(
    'parent_step_key', v_row.parent_step_key,
    'parent_step_status', v_row.parent_step_status,
    'parent_active_jobs', v_row.parent_active_jobs,
    'parent_last_error', v_row.parent_last_error,
    'parent_updated_at', v_row.parent_updated_at
  ) INTO v_parent;

  RETURN jsonb_build_object(
    'job_id', v_row.job_id, 'job_type', v_row.job_type,
    'package_id', v_row.package_id, 'package_title', v_row.package_title,
    'step_key', v_row.step_key, 'job_status', v_row.job_status,
    'last_error', v_row.last_error, 'attempts', v_row.attempts,
    'block_reason', v_row.block_reason,
    'minutes_blocked', v_row.minutes_blocked,
    'bronze_locked', v_row.bronze_locked,
    'parent', v_parent,
    'recent_heal_log', v_log
  );
END $$;
GRANT EXECUTE ON FUNCTION public.admin_get_dag_blocked_drilldown(uuid) TO authenticated;

-- Manual Re-Enqueue per step with audit
CREATE OR REPLACE FUNCTION public.admin_manual_reenqueue_step(
  p_package_id uuid, p_step_key text, p_reason text DEFAULT 'manual_dashboard_reenqueue'
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_uid uuid := auth.uid(); v_curr uuid; v_id uuid;
BEGIN
  IF v_uid IS NULL OR NOT has_role(v_uid,'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='42501';
  END IF;
  IF p_step_key IS NULL OR p_step_key !~ '^[a-z_]+$' THEN
    RAISE EXCEPTION 'invalid_step_key';
  END IF;
  SELECT curriculum_id INTO v_curr FROM course_packages WHERE id = p_package_id;
  IF v_curr IS NULL THEN RAISE EXCEPTION 'package_not_found'; END IF;

  PERFORM set_config('app.transition_source','admin_manual_reenqueue:'||v_uid::text, true);

  INSERT INTO job_queue (job_type, package_id, status, run_after, payload, meta, enqueue_source)
  VALUES (
    'package_'||p_step_key, p_package_id, 'pending', now(),
    jsonb_build_object('package_id', p_package_id, 'curriculum_id', v_curr,
                       'bronze_lock_override', true, 'enqueue_source', p_reason),
    jsonb_build_object('enqueue_source', p_reason, 'manual_admin', v_uid),
    p_reason
  ) RETURNING id INTO v_id;

  INSERT INTO auto_heal_log (action_type, target_type, target_id, result_status, metadata)
  VALUES ('manual_reenqueue_step','package', p_package_id, 'success',
          jsonb_build_object('step_key', p_step_key, 'job_id', v_id, 'admin', v_uid, 'reason', p_reason));

  RETURN jsonb_build_object('ok', true, 'job_id', v_id, 'step_key', p_step_key);
END $$;
GRANT EXECUTE ON FUNCTION public.admin_manual_reenqueue_step(uuid,text,text) TO authenticated;

-- Enable cron snapshot every 10 min
DO $$ BEGIN
  PERFORM cron.unschedule('dag-blocked-history-snapshot-10min');
EXCEPTION WHEN others THEN NULL; END $$;
SELECT cron.schedule('dag-blocked-history-snapshot-10min','*/10 * * * *',
  $$ SELECT public.fn_snapshot_dag_blocked(); $$);

-- Initial snapshot
SELECT public.fn_snapshot_dag_blocked();