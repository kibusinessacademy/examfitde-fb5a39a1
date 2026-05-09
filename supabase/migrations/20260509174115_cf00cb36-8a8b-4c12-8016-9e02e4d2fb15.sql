
-- ───────────────────────────────────────────────────────────────────
-- 1. mark_job_first_heartbeat — extend with edge_invocation_id & heartbeat_count
-- ───────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.mark_job_first_heartbeat(uuid);

CREATE OR REPLACE FUNCTION public.mark_job_first_heartbeat(
  p_job_id uuid,
  p_edge_invocation_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_now timestamptz := now();
  v_existing timestamptz;
  v_locked_at timestamptz;
  v_count int;
BEGIN
  IF p_job_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'job_id_null');
  END IF;

  UPDATE public.job_queue
     SET last_heartbeat_at = v_now,
         meta = COALESCE(meta, '{}'::jsonb)
                || jsonb_build_object(
                     'first_heartbeat_at',
                       COALESCE(meta->>'first_heartbeat_at', v_now::text),
                     'heartbeat_count',
                       COALESCE((meta->>'heartbeat_count')::int, 0) + 1,
                     'edge_invocation_id',
                       COALESCE(p_edge_invocation_id, meta->>'edge_invocation_id')
                   )
   WHERE id = p_job_id
     AND status = 'processing'
   RETURNING locked_at,
             (meta->>'first_heartbeat_at')::timestamptz,
             (meta->>'heartbeat_count')::int
        INTO v_locked_at, v_existing, v_count;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_processing_or_missing');
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'first_heartbeat_at', COALESCE(v_existing, v_now),
    'locked_at', v_locked_at,
    'heartbeat_count', v_count,
    'lag_ms', EXTRACT(EPOCH FROM (v_now - v_locked_at))::int * 1000
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.mark_job_first_heartbeat(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_job_first_heartbeat(uuid, text) TO service_role;

-- ───────────────────────────────────────────────────────────────────
-- 2. admin_get_pre_heartbeat_kill_forensics — clusters + top packages + last events
-- ───────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_get_pre_heartbeat_kill_forensics()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_clusters jsonb;
  v_top_packages jsonb;
  v_recent jsonb;
  v_quarantined jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'admin role required';
  END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(r)), '[]'::jsonb) INTO v_clusters
  FROM (
    SELECT job_type, lane, worker_pool,
           phk_1h, phk_24h, phk_terminal_24h,
           distinct_packages_24h, last_kill_at
    FROM public.v_pre_heartbeat_kill_risk
    ORDER BY phk_24h DESC, phk_terminal_24h DESC
    LIMIT 50
  ) r;

  SELECT COALESCE(jsonb_agg(row_to_json(p)), '[]'::jsonb) INTO v_top_packages
  FROM (
    SELECT (jq.payload->>'package_id')::uuid AS package_id,
           cp.title,
           cp.package_key,
           COUNT(*) AS phk_24h,
           COUNT(*) FILTER (WHERE jq.last_error_code = 'PRE_HEARTBEAT_KILL_TERMINAL') AS terminal_24h,
           MAX(COALESCE(jq.completed_at, jq.updated_at)) AS last_kill_at
    FROM public.job_queue jq
    LEFT JOIN public.course_packages cp ON cp.id = (jq.payload->>'package_id')::uuid
    WHERE jq.last_error_code IN ('PRE_HEARTBEAT_KILL','PRE_HEARTBEAT_KILL_TERMINAL')
      AND COALESCE(jq.completed_at, jq.updated_at) > now() - interval '24 hours'
      AND (jq.payload->>'package_id') IS NOT NULL
    GROUP BY (jq.payload->>'package_id')::uuid, cp.title, cp.package_key
    ORDER BY COUNT(*) DESC
    LIMIT 25
  ) p;

  SELECT COALESCE(jsonb_agg(row_to_json(e)), '[]'::jsonb) INTO v_recent
  FROM (
    SELECT jq.id AS job_id,
           jq.job_type,
           jq.lane,
           jq.worker_pool,
           (jq.payload->>'package_id')::uuid AS package_id,
           jq.last_error_code,
           jq.last_error_message,
           jq.attempts,
           COALESCE(jq.completed_at, jq.updated_at) AS killed_at,
           jq.locked_at,
           (jq.meta->>'first_heartbeat_at')::timestamptz AS first_heartbeat_at,
           (jq.meta->>'heartbeat_count')::int AS heartbeat_count,
           jq.meta->>'edge_invocation_id' AS edge_invocation_id,
           COALESCE((jq.meta->>'pre_heartbeat_kill_count')::int, 0) AS phk_count
    FROM public.job_queue jq
    WHERE jq.last_error_code IN ('PRE_HEARTBEAT_KILL','PRE_HEARTBEAT_KILL_TERMINAL')
      AND COALESCE(jq.completed_at, jq.updated_at) > now() - interval '24 hours'
    ORDER BY COALESCE(jq.completed_at, jq.updated_at) DESC
    LIMIT 25
  ) e;

  SELECT COALESCE(jsonb_agg(row_to_json(q)), '[]'::jsonb) INTO v_quarantined
  FROM (
    SELECT cp.id AS package_id,
           cp.title,
           cp.package_key,
           (cp.feature_flags->'pre_heartbeat_quarantine'->>'occurrences')::int AS occurrences,
           (cp.feature_flags->'pre_heartbeat_quarantine'->>'activated_at')::timestamptz AS activated_at
    FROM public.course_packages cp
    WHERE COALESCE((cp.feature_flags->'pre_heartbeat_quarantine'->>'active')::boolean, false) = true
    ORDER BY (cp.feature_flags->'pre_heartbeat_quarantine'->>'activated_at')::timestamptz DESC NULLS LAST
    LIMIT 50
  ) q;

  RETURN jsonb_build_object(
    'generated_at', now(),
    'clusters', v_clusters,
    'top_packages_24h', v_top_packages,
    'recent_kills', v_recent,
    'quarantined_packages', v_quarantined
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_get_pre_heartbeat_kill_forensics() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_pre_heartbeat_kill_forensics() TO authenticated, service_role;

-- ───────────────────────────────────────────────────────────────────
-- 3. admin_requeue_pre_heartbeat_quarantine — selective, with reason, anti-loop
-- ───────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_requeue_pre_heartbeat_quarantine(
  p_package_id uuid DEFAULT NULL,
  p_job_id uuid DEFAULT NULL,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_quarantine_cleared boolean := false;
  v_job_requeued boolean := false;
  v_job_pkg uuid;
  v_phk_count int;
BEGIN
  IF NOT public.has_role(v_actor, 'admin'::app_role) THEN
    RAISE EXCEPTION 'admin role required';
  END IF;

  IF p_reason IS NULL OR length(trim(p_reason)) < 5 THEN
    RAISE EXCEPTION 'reason required (min 5 chars)';
  END IF;

  IF p_package_id IS NULL AND p_job_id IS NULL THEN
    RAISE EXCEPTION 'either p_package_id or p_job_id required';
  END IF;

  -- Resolve job → package, if job_id given
  IF p_job_id IS NOT NULL THEN
    SELECT (payload->>'package_id')::uuid,
           COALESCE((meta->>'pre_heartbeat_kill_count')::int, 0)
      INTO v_job_pkg, v_phk_count
      FROM public.job_queue
     WHERE id = p_job_id;

    IF v_job_pkg IS NULL THEN
      RAISE EXCEPTION 'job % not found or has no package_id', p_job_id;
    END IF;

    IF p_package_id IS NULL THEN
      p_package_id := v_job_pkg;
    ELSIF p_package_id <> v_job_pkg THEN
      RAISE EXCEPTION 'job package mismatch: job=% pkg=%', v_job_pkg, p_package_id;
    END IF;
  END IF;

  -- Clear pre_heartbeat_quarantine flag on package (idempotent)
  UPDATE public.course_packages
     SET feature_flags = COALESCE(feature_flags, '{}'::jsonb)
                         || jsonb_build_object(
                              'pre_heartbeat_quarantine',
                              COALESCE(feature_flags->'pre_heartbeat_quarantine', '{}'::jsonb)
                              || jsonb_build_object(
                                   'active', false,
                                   'cleared_at', now()::text,
                                   'cleared_by', v_actor::text,
                                   'cleared_reason', p_reason
                                 )
                            )
   WHERE id = p_package_id
     AND COALESCE((feature_flags->'pre_heartbeat_quarantine'->>'active')::boolean, false) = true
   RETURNING true INTO v_quarantine_cleared;

  v_quarantine_cleared := COALESCE(v_quarantine_cleared, false);

  -- Selective requeue of single job (only if explicitly requested + terminal)
  IF p_job_id IS NOT NULL THEN
    UPDATE public.job_queue
       SET status = 'pending',
           run_after = now() + interval '30 seconds',
           locked_at = NULL,
           locked_by = NULL,
           started_at = NULL,
           last_error_code = NULL,
           last_error_message = NULL,
           liveness_status = 'idle',
           updated_at = now(),
           meta = COALESCE(meta, '{}'::jsonb)
                  || jsonb_build_object(
                       'phk_quarantine_requeued_at', now()::text,
                       'phk_quarantine_requeued_by', v_actor::text,
                       'phk_quarantine_requeue_reason', p_reason
                     )
     WHERE id = p_job_id
       AND status IN ('failed','cancelled')
       AND last_error_code IN ('PRE_HEARTBEAT_KILL','PRE_HEARTBEAT_KILL_TERMINAL')
     RETURNING true INTO v_job_requeued;

    v_job_requeued := COALESCE(v_job_requeued, false);
  END IF;

  -- Audit
  INSERT INTO public.auto_heal_log (
    action_type, target_type, target_id, result_status, payload
  ) VALUES (
    'phk_quarantine_requeue',
    CASE WHEN p_job_id IS NOT NULL THEN 'job' ELSE 'package' END,
    COALESCE(p_job_id::text, p_package_id::text),
    CASE WHEN v_quarantine_cleared OR v_job_requeued THEN 'success' ELSE 'noop' END,
    jsonb_build_object(
      'package_id', p_package_id,
      'job_id', p_job_id,
      'reason', p_reason,
      'actor', v_actor,
      'quarantine_cleared', v_quarantine_cleared,
      'job_requeued', v_job_requeued,
      'phk_count_at_requeue', v_phk_count
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'package_id', p_package_id,
    'job_id', p_job_id,
    'quarantine_cleared', v_quarantine_cleared,
    'job_requeued', v_job_requeued
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_requeue_pre_heartbeat_quarantine(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_requeue_pre_heartbeat_quarantine(uuid, uuid, text) TO authenticated, service_role;
