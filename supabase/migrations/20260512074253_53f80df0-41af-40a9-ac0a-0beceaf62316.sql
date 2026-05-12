
CREATE OR REPLACE FUNCTION public.fn_recheck_coverage_and_dispatch_auto_publish(p_package_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_pkg record;
  v_cov record;
  v_min_pct numeric;
  v_decision text;
  v_job_id uuid;
  v_bronze_locked boolean;
  v_active_job uuid;
BEGIN
  SELECT cp.id, cp.curriculum_id, cp.track::text AS track, cp.status::text AS status, cp.feature_flags
    INTO v_pkg
  FROM course_packages cp WHERE cp.id = p_package_id;

  IF v_pkg.id IS NULL THEN
    RETURN jsonb_build_object('decision','SKIPPED_PACKAGE_NOT_FOUND');
  END IF;

  IF v_pkg.status NOT IN ('building') THEN
    RETURN jsonb_build_object('decision','SKIPPED_NOT_BUILDING','status',v_pkg.status);
  END IF;

  SELECT * INTO v_cov FROM public.fn_compute_package_coverage(p_package_id) LIMIT 1;
  SELECT min_competency_question_coverage_pct
    INTO v_min_pct
  FROM public.fn_track_min_coverage_thresholds(v_pkg.track);

  v_bronze_locked := COALESCE((v_pkg.feature_flags->'bronze'->>'requires_review')::boolean, false);

  IF v_cov.competency_question_coverage_pct >= v_min_pct THEN
    SELECT jq.id INTO v_active_job
    FROM job_queue jq
    WHERE jq.package_id = p_package_id
      AND jq.job_type='package_auto_publish'
      AND jq.status IN ('pending','queued','processing')
    LIMIT 1;

    IF v_active_job IS NOT NULL THEN
      v_decision := 'SKIPPED_ACTIVE_JOB';
    ELSE
      INSERT INTO job_queue (job_type, status, package_id, payload, priority, worker_pool, job_name, run_after, created_at, updated_at)
      VALUES (
        'package_auto_publish','pending', p_package_id,
        jsonb_build_object(
          'package_id', p_package_id,
          'curriculum_id', v_pkg.curriculum_id,
          'step_key','auto_publish',
          'enqueue_source','coverage_recheck_dispatch',
          'bronze_lock_override', v_bronze_locked,
          'reason','coverage_threshold_met_after_generation',
          'coverage_pct', v_cov.competency_question_coverage_pct,
          'min_pct', v_min_pct
        ),
        5,'core','package_auto_publish', now(), now(), now()
      ) RETURNING id INTO v_job_id;

      UPDATE package_steps
      SET status='queued',
          updated_at=now(),
          meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object(
            'auto_recheck_dispatch_at', now()::text,
            'coverage_pct', v_cov.competency_question_coverage_pct
          )
      WHERE package_id = p_package_id AND step_key='auto_publish' AND status IN ('failed','queued');

      v_decision := 'DISPATCHED';
    END IF;
  ELSE
    v_decision := 'PARKED_BELOW_THRESHOLD';
  END IF;

  INSERT INTO auto_heal_log(action_type, target_type, target_id, result_status, metadata)
  VALUES (
    'coverage_recheck_dispatch','package', p_package_id,
    CASE WHEN v_decision='DISPATCHED' THEN 'success'
         WHEN v_decision LIKE 'SKIPPED_%' THEN 'noop'
         ELSE 'parked' END,
    jsonb_build_object('decision', v_decision,'coverage_pct', v_cov.competency_question_coverage_pct,
      'min_pct', v_min_pct,'track', v_pkg.track,'bronze_lock_override', v_bronze_locked,'job_id', v_job_id)
  );

  RETURN jsonb_build_object('decision', v_decision,'coverage_pct', v_cov.competency_question_coverage_pct,'min_pct', v_min_pct,'job_id', v_job_id);
END $$;

REVOKE ALL ON FUNCTION public.fn_recheck_coverage_and_dispatch_auto_publish(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_recheck_coverage_and_dispatch_auto_publish(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.trg_recheck_coverage_after_pool_complete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.job_type = 'package_generate_exam_pool'
     AND NEW.status = 'completed'
     AND OLD.status IS DISTINCT FROM 'completed'
     AND COALESCE((NEW.payload->>'requeue_tail_after_success')::boolean, false) = true
     AND NEW.package_id IS NOT NULL THEN
    PERFORM public.fn_recheck_coverage_and_dispatch_auto_publish(NEW.package_id);
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_recheck_coverage_after_pool_complete ON public.job_queue;
CREATE TRIGGER trg_recheck_coverage_after_pool_complete
AFTER UPDATE OF status ON public.job_queue
FOR EACH ROW
EXECUTE FUNCTION public.trg_recheck_coverage_after_pool_complete();

CREATE OR REPLACE VIEW public.v_admin_auto_publish_error_overview AS
SELECT
  jq.id AS job_id,
  jq.package_id,
  cp.package_key,
  cp.title AS package_title,
  cp.status::text AS package_status,
  cp.track::text AS track,
  jq.status AS job_status,
  jq.attempts,
  jq.max_attempts,
  jq.created_at,
  jq.updated_at,
  jq.last_heartbeat_at,
  jq.locked_at,
  left(jq.last_error, 240) AS last_error_short,
  jq.last_error,
  public.fn_classify_publish_last_error(jq.last_error) AS error_bucket,
  cov.competency_question_coverage_pct AS coverage_pct,
  thr.min_competency_question_coverage_pct AS coverage_min_pct,
  CASE WHEN cov.competency_question_coverage_pct IS NULL THEN NULL
       ELSE GREATEST(thr.min_competency_question_coverage_pct - cov.competency_question_coverage_pct, 0) END AS coverage_gap_pp,
  COALESCE((cp.feature_flags->'bronze'->>'requires_review')::boolean, false) AS bronze_locked
FROM job_queue jq
JOIN course_packages cp ON cp.id = jq.package_id
LEFT JOIN LATERAL public.fn_compute_package_coverage(jq.package_id) cov ON true
LEFT JOIN LATERAL public.fn_track_min_coverage_thresholds(cp.track::text) thr ON true
WHERE jq.job_type = 'package_auto_publish'
  AND jq.created_at > now() - interval '7 days';

REVOKE ALL ON public.v_admin_auto_publish_error_overview FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_admin_auto_publish_error_overview TO service_role;

CREATE OR REPLACE FUNCTION public.admin_get_auto_publish_error_overview(
  p_package_ids uuid[] DEFAULT NULL,
  p_only_problems boolean DEFAULT false
) RETURNS SETOF public.v_admin_auto_publish_error_overview
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'admin role required';
  END IF;
  RETURN QUERY
    SELECT * FROM public.v_admin_auto_publish_error_overview v
    WHERE (p_package_ids IS NULL OR v.package_id = ANY(p_package_ids))
      AND (NOT p_only_problems OR v.job_status IN ('failed','cancelled','pending','queued','processing'))
    ORDER BY
      CASE v.job_status WHEN 'processing' THEN 0 WHEN 'failed' THEN 1 WHEN 'cancelled' THEN 2 ELSE 3 END,
      v.updated_at DESC;
END $$;

REVOKE ALL ON FUNCTION public.admin_get_auto_publish_error_overview(uuid[], boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_auto_publish_error_overview(uuid[], boolean) TO authenticated;

CREATE OR REPLACE VIEW public.v_admin_stale_lock_escalations AS
WITH base AS (
  SELECT
    jq.id AS job_id, jq.job_type, jq.package_id, jq.status, jq.attempts, jq.max_attempts,
    jq.last_error, jq.locked_at, jq.last_heartbeat_at, jq.updated_at,
    COALESCE((jq.meta->>'stale_lock_recoveries')::int, 0) AS recovery_count,
    COALESCE((jq.meta->>'stale_reap_count')::int, 0) AS reap_count
  FROM job_queue jq
  WHERE
    (jq.status = 'processing'
     AND COALESCE(jq.last_heartbeat_at, jq.locked_at) < now() - interval '10 minutes')
    OR (jq.last_error LIKE '%STALE_LOCK%' AND jq.updated_at > now() - interval '24 hours')
)
SELECT
  b.*, cp.package_key, cp.title AS package_title,
  CASE
    WHEN b.last_error LIKE '%STALE_LOCK_LOOP_HARD_KILL%' THEN 'HARD_KILLED'
    WHEN b.recovery_count >= 2 THEN 'EXHAUSTED_RECOVERY'
    WHEN b.recovery_count >= 1 THEN 'RECOVERING'
    WHEN b.status='processing' AND COALESCE(b.last_heartbeat_at, b.locked_at) < now() - interval '20 minutes' THEN 'STALE_LONG'
    WHEN b.status='processing' THEN 'STALE_SHORT'
    ELSE 'TERMINAL'
  END AS escalation_state,
  EXTRACT(EPOCH FROM (now() - COALESCE(b.last_heartbeat_at, b.locked_at)))::int AS stale_seconds
FROM base b
LEFT JOIN course_packages cp ON cp.id = b.package_id;

REVOKE ALL ON public.v_admin_stale_lock_escalations FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_admin_stale_lock_escalations TO service_role;

CREATE OR REPLACE FUNCTION public.admin_get_stale_lock_escalations()
RETURNS SETOF public.v_admin_stale_lock_escalations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'admin role required';
  END IF;
  RETURN QUERY SELECT * FROM public.v_admin_stale_lock_escalations
  ORDER BY
    CASE escalation_state
      WHEN 'HARD_KILLED' THEN 0 WHEN 'EXHAUSTED_RECOVERY' THEN 1
      WHEN 'STALE_LONG' THEN 2 WHEN 'RECOVERING' THEN 3
      WHEN 'STALE_SHORT' THEN 4 ELSE 5 END,
    stale_seconds DESC NULLS LAST;
END $$;

REVOKE ALL ON FUNCTION public.admin_get_stale_lock_escalations() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_stale_lock_escalations() TO authenticated;

CREATE OR REPLACE FUNCTION public.fn_alert_stale_lock_hard_kills()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_count int; v_alert_key text;
BEGIN
  SELECT count(*) INTO v_count
  FROM job_queue
  WHERE last_error LIKE '%STALE_LOCK_LOOP_HARD_KILL%'
    AND updated_at > now() - interval '30 minutes';

  IF v_count < 3 THEN
    RETURN jsonb_build_object('emitted', false, 'count', v_count);
  END IF;

  v_alert_key := format('ops.stale_lock.hard_kill_burst.%s', to_char(date_trunc('hour', now()), 'YYYYMMDDHH24'));

  INSERT INTO heal_alert_notifications (
    destination_id, channel, target, alert_key, severity, payload, status, max_attempts
  )
  SELECT d.id, d.channel, d.target, v_alert_key, 'high',
    jsonb_build_object('kind','stale_lock_hard_kill_burst','count_30min', v_count,'window_min', 30),
    'pending', 5
  FROM heal_alert_destinations d
  WHERE COALESCE(d.enabled, true) = true
  ON CONFLICT DO NOTHING;

  RETURN jsonb_build_object('emitted', true, 'count', v_count, 'alert_key', v_alert_key);
END $$;

REVOKE ALL ON FUNCTION public.fn_alert_stale_lock_hard_kills() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_alert_stale_lock_hard_kills() TO service_role;
