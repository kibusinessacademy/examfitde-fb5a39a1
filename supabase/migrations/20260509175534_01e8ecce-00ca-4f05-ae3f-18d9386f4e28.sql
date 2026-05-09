
-- ─────────────────────────────────────────────────────────────
-- 1. Fix lag_ms math bug in mark_job_first_heartbeat
-- ─────────────────────────────────────────────────────────────
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
    'lag_ms', (EXTRACT(EPOCH FROM (v_now - v_locked_at)) * 1000)::int
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.mark_job_first_heartbeat(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_job_first_heartbeat(uuid, text) TO service_role;

-- ─────────────────────────────────────────────────────────────
-- 2. Fix audit insert: use metadata (auto_heal_log has no payload column)
-- ─────────────────────────────────────────────────────────────
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

  IF p_job_id IS NOT NULL THEN
    UPDATE public.job_queue
       SET status = 'pending',
           run_after = now() + interval '30 seconds',
           locked_at = NULL,
           locked_by = NULL,
           started_at = NULL,
           last_error_code = NULL,
           last_error_message = NULL,
           liveness_status = 'healthy',
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

  -- Audit (use metadata — auto_heal_log has no `payload` column)
  INSERT INTO public.auto_heal_log (
    action_type, target_type, target_id, result_status, metadata
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

-- ─────────────────────────────────────────────────────────────
-- 3. Reaper: classify STALE_AFTER_HEARTBEAT vs PRE_HEARTBEAT_KILL
--    PHK paths (A/A2/B) keep existing semantics; loop-kill path
--    now stamps STALE_AFTER_HEARTBEAT when last_heartbeat_at IS NOT NULL.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_reap_stale_processing_jobs(p_stale_minutes integer DEFAULT 10)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_requeued int := 0; v_failed int := 0; v_loop_killed int := 0;
  v_stale_after_hb int := 0;
  v_phk_requeued int := 0; v_phk_terminal int := 0; v_quarantined_pkgs int := 0;
  v_cutoff timestamptz; v_phk_cutoff timestamptz;
  v_max_reaps int := 2; v_max_phk int := 2;
BEGIN
  v_cutoff := now() - (p_stale_minutes || ' minutes')::interval;
  v_phk_cutoff := now() - interval '3 minutes';

  -- (PHK-A) terminal on 2nd PHK
  WITH phk_terminal AS (
    SELECT id, package_id, COALESCE((meta->>'pre_heartbeat_kill_count')::int, 0) AS phk_count
    FROM public.job_queue
    WHERE status = 'processing' AND last_heartbeat_at IS NULL AND locked_at IS NOT NULL
      AND locked_at < v_phk_cutoff
      AND COALESCE((meta->>'pre_heartbeat_kill_count')::int, 0) >= (v_max_phk - 1)
    FOR UPDATE SKIP LOCKED
  ),
  upd_phk_terminal AS (
    UPDATE public.job_queue jq
    SET status='failed', completed_at=now(), locked_at=NULL, locked_by=NULL,
        liveness_status='killed',
        last_error='PRE_HEARTBEAT_KILL_TERMINAL: claimed >= '||v_max_phk||' times without ever sending a heartbeat',
        last_error_code='PRE_HEARTBEAT_KILL_TERMINAL',
        meta=COALESCE(meta,'{}'::jsonb) || jsonb_build_object(
          'pre_heartbeat_kill_terminal_at', to_jsonb(now()),
          'pre_heartbeat_kill_count', p.phk_count + 1),
        updated_at=now()
    FROM phk_terminal p WHERE jq.id = p.id
    RETURNING jq.id
  )
  SELECT count(*) INTO v_phk_terminal FROM upd_phk_terminal;

  -- (PHK-A2) Quarantine
  WITH q AS (
    UPDATE public.course_packages cp
    SET feature_flags = COALESCE(cp.feature_flags,'{}'::jsonb) || jsonb_build_object(
      'pre_heartbeat_quarantine',
        COALESCE(cp.feature_flags->'pre_heartbeat_quarantine','{}'::jsonb)
        || jsonb_build_object(
          'active', true,
          'reason', 'PRE_HEARTBEAT_KILL_TERMINAL',
          'quarantined_at', to_jsonb(now()),
          'occurrences', COALESCE((cp.feature_flags->'pre_heartbeat_quarantine'->>'occurrences')::int, 0) + 1,
          'manual_bypass', false
        )),
      updated_at = now()
    WHERE cp.id IN (
      SELECT DISTINCT package_id FROM public.job_queue
      WHERE last_error_code='PRE_HEARTBEAT_KILL_TERMINAL'
        AND completed_at > now() - interval '5 minutes' AND package_id IS NOT NULL
    )
    RETURNING cp.id
  )
  SELECT count(*) INTO v_quarantined_pkgs FROM q;

  -- (PHK-B) requeue below threshold
  WITH phk_requeue AS (
    SELECT id, COALESCE((meta->>'pre_heartbeat_kill_count')::int, 0) AS phk_count
    FROM public.job_queue
    WHERE status='processing' AND last_heartbeat_at IS NULL AND locked_at IS NOT NULL
      AND locked_at < v_phk_cutoff
      AND COALESCE((meta->>'pre_heartbeat_kill_count')::int, 0) < (v_max_phk - 1)
      AND COALESCE(attempts,0) < COALESCE(max_attempts,25)
    FOR UPDATE SKIP LOCKED
  ),
  upd_phk_requeue AS (
    UPDATE public.job_queue jq
    SET status='pending', locked_at=NULL, locked_by=NULL, last_heartbeat_at=NULL,
        liveness_status='pre_heartbeat_killed',
        last_error='PRE_HEARTBEAT_KILL: claimed but no heartbeat in 3min — requeued (#'||(p.phk_count+1)||')',
        last_error_code='PRE_HEARTBEAT_KILL',
        run_after = now() + interval '5 minutes' + (random() * interval '60 seconds'),
        meta = COALESCE(jq.meta,'{}'::jsonb) || jsonb_build_object(
          'pre_heartbeat_kill_count', p.phk_count + 1,
          'last_pre_heartbeat_kill_at', to_jsonb(now())),
        updated_at=now()
    FROM phk_requeue p WHERE jq.id = p.id
    RETURNING jq.id
  )
  SELECT count(*) INTO v_phk_requeued FROM upd_phk_requeue;

  -- (a) generic loop-kill — heartbeat exists ⇒ STALE_AFTER_HEARTBEAT
  WITH loop_jobs AS (
    SELECT id, last_heartbeat_at FROM public.job_queue
    WHERE status='processing' AND COALESCE(last_heartbeat_at, locked_at, started_at) < v_cutoff
      AND COALESCE((meta->>'stale_reap_count')::int,0) >= v_max_reaps
      AND NOT (last_heartbeat_at IS NULL AND locked_at IS NOT NULL)
    FOR UPDATE SKIP LOCKED
  ),
  upd_loop AS (
    UPDATE public.job_queue jq
    SET status='failed', completed_at=now(), locked_at=NULL, locked_by=NULL,
        liveness_status='killed',
        last_error = CASE
          WHEN p.last_heartbeat_at IS NOT NULL
            THEN 'STALE_AFTER_HEARTBEAT: heartbeat seen but stalled past '||p_stale_minutes||'min — hard-killed'
          ELSE 'STALE_PROCESSING_LOOP_HARD_KILL: stalled past '||p_stale_minutes||'min — hard-killed'
        END,
        last_error_code = CASE
          WHEN p.last_heartbeat_at IS NOT NULL THEN 'STALE_AFTER_HEARTBEAT'
          ELSE 'STALE_LOCK_LOOP_HARD_KILL'
        END,
        meta=COALESCE(meta,'{}'::jsonb) || jsonb_build_object(
          CASE WHEN p.last_heartbeat_at IS NOT NULL
               THEN 'stale_after_heartbeat_at' ELSE 'loop_killed_at' END,
          to_jsonb(now())),
        updated_at=now()
    FROM loop_jobs p WHERE jq.id = p.id
    RETURNING jq.id, (CASE WHEN p.last_heartbeat_at IS NOT NULL THEN 1 ELSE 0 END) AS is_after_hb
    -- NOTE: postgres CTE cannot reference p in RETURNING — count separately below
  )
  SELECT count(*) INTO v_loop_killed FROM upd_loop;

  -- recount STALE_AFTER_HEARTBEAT in last 30s for telemetry
  SELECT count(*) INTO v_stale_after_hb
    FROM public.job_queue
   WHERE last_error_code = 'STALE_AFTER_HEARTBEAT'
     AND updated_at > now() - interval '30 seconds';

  -- (b) requeue stale processing (heartbeat-aware) — one more attempt, count++
  WITH stale_jobs AS (
    SELECT id, COALESCE((meta->>'stale_reap_count')::int,0) AS reap_count
    FROM public.job_queue
    WHERE status='processing' AND COALESCE(last_heartbeat_at, locked_at, started_at) < v_cutoff
      AND COALESCE((meta->>'stale_reap_count')::int,0) < v_max_reaps
      AND NOT (last_heartbeat_at IS NULL AND locked_at IS NOT NULL)
      AND COALESCE(attempts,0) < COALESCE(max_attempts,25)
    FOR UPDATE SKIP LOCKED
  ),
  upd_stale AS (
    UPDATE public.job_queue jq
    SET status='pending', locked_at=NULL, locked_by=NULL, last_heartbeat_at=NULL,
        liveness_status='zombie_reaped',
        last_error='STALE_PROCESSING_REAPED: requeued (#'||(s.reap_count+1)||')',
        last_error_code='STALE_PROCESSING_REAPED',
        run_after = now() + interval '2 minutes' + (random() * interval '30 seconds'),
        meta = COALESCE(jq.meta,'{}'::jsonb) || jsonb_build_object('stale_reap_count', s.reap_count + 1),
        updated_at=now()
    FROM stale_jobs s WHERE jq.id = s.id
    RETURNING jq.id
  )
  SELECT count(*) INTO v_requeued FROM upd_stale;

  -- (c) max-attempts terminate
  WITH ex AS (
    UPDATE public.job_queue
    SET status='failed', completed_at=now(), locked_at=NULL, locked_by=NULL,
        liveness_status='cooldown_exhausted',
        last_error='STALE_PROCESSING_EXHAUSTED: max_attempts reached',
        last_error_code='STALE_PROCESSING_EXHAUSTED',
        updated_at=now()
    WHERE status='processing' AND COALESCE(last_heartbeat_at, locked_at, started_at) < v_cutoff
      AND COALESCE(attempts,0) >= COALESCE(max_attempts,25)
      AND NOT (last_heartbeat_at IS NULL AND locked_at IS NOT NULL)
    RETURNING id
  )
  SELECT count(*) INTO v_failed FROM ex;

  RETURN jsonb_build_object(
    'cutoff_minutes', p_stale_minutes,
    'phk_cutoff_minutes', 3,
    'phk_terminal', v_phk_terminal,
    'quarantined_packages', v_quarantined_pkgs,
    'phk_requeued', v_phk_requeued,
    'requeued', v_requeued,
    'loop_killed', v_loop_killed,
    'stale_after_heartbeat_30s', v_stale_after_hb,
    'failed_exhausted', v_failed,
    'at', now()
  );
END;
$function$;
