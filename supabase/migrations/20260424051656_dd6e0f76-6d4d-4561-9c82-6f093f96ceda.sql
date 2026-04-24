-- =========================================================================
-- 1. Enriched Stuck-Steps View mit Fix-Prognose
-- =========================================================================
CREATE OR REPLACE VIEW public.v_pending_enqueue_stuck_enriched AS
SELECT
  s.package_id,
  s.package_title,
  s.package_status,
  s.step_key,
  s.pending_since,
  s.age_seconds,
  s.has_active_job,
  s.meta,
  -- Manual-Review-Verknüpfung
  mr.id            AS manual_review_id,
  mr.status        AS manual_review_status,
  mr.failure_count AS manual_review_failure_count,
  mr.last_error    AS manual_review_last_error,
  -- Fix-Prognose
  CASE
    WHEN mr.id IS NOT NULL AND mr.status IN ('open','investigating')
                                          THEN 'manual_review_required'
    WHEN s.package_status IS DISTINCT FROM 'building'
                                          THEN 'blocked_by_package_status'
    WHEN s.has_active_job                 THEN 'blocked_by_active_job'
    WHEN s.age_seconds < 300              THEN 'awaiting_min_age'
    ELSE                                       'eligible_now'
  END AS fix_prognosis
FROM public.v_pending_enqueue_stuck s
LEFT JOIN public.pending_enqueue_manual_review mr
  ON  mr.package_id = s.package_id
  AND mr.step_key   = s.step_key
  AND mr.status IN ('open','investigating');

GRANT SELECT ON public.v_pending_enqueue_stuck_enriched TO authenticated;

COMMENT ON VIEW public.v_pending_enqueue_stuck_enriched IS
'Stuck Pending-Enqueue Steps mit deterministischer Fix-Prognose und Manual-Review-Status für Admin-Dashboards.';

-- =========================================================================
-- 2. Audit-Export View mit Cron-Run-Verknüpfung
-- =========================================================================
CREATE OR REPLACE VIEW public.v_pending_enqueue_audit_export AS
SELECT
  l.id                AS log_id,
  l.created_at,
  l.package_id,
  cp.title            AS package_title,
  l.step_key,
  l.prev_status,
  l.new_status,
  l.reason,
  l.triggered_by,
  l.age_seconds,
  -- Trigger-Fehlercode aus reason extrahieren (sofern reschedule_failed: ...)
  CASE
    WHEN l.reason LIKE 'reschedule_failed:%'
      THEN regexp_replace(l.reason, '^reschedule_failed:\s*', '')
    ELSE NULL
  END                 AS error_message,
  -- Nächstgelegener Cron-Run im 90s-Fenster für triggered_by='cron'
  cr.runid            AS cron_run_id,
  cr.jobid            AS cron_job_id,
  cr.start_time       AS cron_start_time,
  cr.status           AS cron_run_status,
  l.meta_snapshot
FROM public.pending_enqueue_reschedule_log l
LEFT JOIN public.course_packages cp ON cp.id = l.package_id
LEFT JOIN LATERAL (
  SELECT jrd.runid, jrd.jobid, jrd.start_time, jrd.status
  FROM cron.job_run_details jrd
  JOIN cron.job j ON j.jobid = jrd.jobid
  WHERE j.jobname LIKE '%pending_enqueue%'
    AND jrd.start_time BETWEEN l.created_at - interval '90 seconds'
                           AND l.created_at + interval '5 seconds'
  ORDER BY abs(EXTRACT(EPOCH FROM (jrd.start_time - l.created_at))) ASC
  LIMIT 1
) cr ON true;

GRANT SELECT ON public.v_pending_enqueue_audit_export TO authenticated;

-- =========================================================================
-- 3. Admin-Helper: Force-Reschedule eines einzelnen Steps (bypass min_age)
-- =========================================================================
CREATE OR REPLACE FUNCTION public.fn_force_reschedule_step(
  p_package_id uuid,
  p_step_key   text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _is_admin    boolean;
  _pkg_status  text;
  _has_active  boolean;
  _job_type    text;
  _step_meta   jsonb;
  _affected    integer;
BEGIN
  SELECT public.has_role(auth.uid(), 'admin'::app_role) INTO _is_admin;
  IF NOT COALESCE(_is_admin, false) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden: admin role required');
  END IF;

  SELECT cp.status INTO _pkg_status FROM public.course_packages cp WHERE cp.id = p_package_id;
  IF _pkg_status IS DISTINCT FROM 'building' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'package_not_building', 'package_status', _pkg_status);
  END IF;

  _job_type := 'package_' || p_step_key;
  SELECT EXISTS (
    SELECT 1 FROM public.job_queue jq
    WHERE jq.package_id = p_package_id
      AND jq.job_type   = _job_type
      AND jq.status IN ('pending','queued','processing','running','batch_pending')
  ) INTO _has_active;

  IF _has_active THEN
    RETURN jsonb_build_object('ok', false, 'error', 'active_job_exists', 'job_type', _job_type);
  END IF;

  SELECT meta INTO _step_meta
  FROM public.package_steps
  WHERE package_id = p_package_id AND step_key = p_step_key AND status = 'pending_enqueue';

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'step_not_pending_enqueue');
  END IF;

  BEGIN
    UPDATE public.package_steps
       SET status = 'queued',
           meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
                    'pending_enqueue_rescheduled_at', now(),
                    'pending_enqueue_rescheduled_by', 'admin_force'
                  )
     WHERE package_id = p_package_id
       AND step_key   = p_step_key
       AND status     = 'pending_enqueue';
    GET DIAGNOSTICS _affected = ROW_COUNT;

    INSERT INTO public.pending_enqueue_reschedule_log
      (package_id, step_key, prev_status, new_status, reason, triggered_by, age_seconds, meta_snapshot)
    VALUES
      (p_package_id, p_step_key, 'pending_enqueue',
       CASE WHEN _affected > 0 THEN 'queued' ELSE 'pending_enqueue' END,
       CASE WHEN _affected > 0 THEN 'admin_force_reschedule' ELSE 'admin_force_noop' END,
       'admin_force', 0, _step_meta);

    -- offene Manual-Review-Einträge schließen, falls Reschedule erfolgreich
    IF _affected > 0 THEN
      UPDATE public.pending_enqueue_manual_review
         SET status = 'resolved',
             resolution_note = COALESCE(resolution_note,'') || E'\n[admin_force_reschedule] ' || now()::text,
             resolved_at = now(),
             resolved_by = auth.uid()
       WHERE package_id = p_package_id
         AND step_key   = p_step_key
         AND status IN ('open','investigating');
    END IF;

    RETURN jsonb_build_object('ok', _affected > 0, 'affected', _affected);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO public.pending_enqueue_reschedule_log
      (package_id, step_key, prev_status, new_status, reason, triggered_by, age_seconds, meta_snapshot)
    VALUES
      (p_package_id, p_step_key, 'pending_enqueue', 'pending_enqueue',
       'reschedule_failed: ' || SQLERRM, 'admin_force', 0, _step_meta);
    RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
  END;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_force_reschedule_step(uuid, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.fn_force_reschedule_step(uuid, text) TO authenticated;

-- =========================================================================
-- 4. Admin-Helper: Cancel pending_enqueue Step → blocked
-- =========================================================================
CREATE OR REPLACE FUNCTION public.fn_cancel_pending_enqueue_step(
  p_package_id uuid,
  p_step_key   text,
  p_reason     text DEFAULT 'admin_cancel'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _is_admin boolean;
  _affected integer;
  _step_meta jsonb;
BEGIN
  SELECT public.has_role(auth.uid(), 'admin'::app_role) INTO _is_admin;
  IF NOT COALESCE(_is_admin, false) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden: admin role required');
  END IF;

  SELECT meta INTO _step_meta
  FROM public.package_steps
  WHERE package_id = p_package_id AND step_key = p_step_key AND status = 'pending_enqueue';

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'step_not_pending_enqueue');
  END IF;

  UPDATE public.package_steps
     SET status = 'blocked',
         meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
                  'cancelled_at', now(),
                  'cancelled_by', auth.uid(),
                  'cancel_reason', p_reason
                )
   WHERE package_id = p_package_id
     AND step_key   = p_step_key
     AND status     = 'pending_enqueue';
  GET DIAGNOSTICS _affected = ROW_COUNT;

  INSERT INTO public.pending_enqueue_reschedule_log
    (package_id, step_key, prev_status, new_status, reason, triggered_by, age_seconds, meta_snapshot)
  VALUES
    (p_package_id, p_step_key, 'pending_enqueue', 'blocked',
     'admin_cancel: ' || p_reason, 'admin_cancel', 0, _step_meta);

  UPDATE public.pending_enqueue_manual_review
     SET status = 'wont_fix',
         resolution_note = COALESCE(resolution_note,'') || E'\n[admin_cancel] ' || p_reason,
         resolved_at = now(),
         resolved_by = auth.uid()
   WHERE package_id = p_package_id
     AND step_key   = p_step_key
     AND status IN ('open','investigating');

  RETURN jsonb_build_object('ok', _affected > 0, 'affected', _affected);
END;
$$;

REVOKE ALL ON FUNCTION public.fn_cancel_pending_enqueue_step(uuid, text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.fn_cancel_pending_enqueue_step(uuid, text, text) TO authenticated;

-- =========================================================================
-- 5. Admin-Helper: Replay der letzten N Minuten (idempotent)
-- =========================================================================
-- Ruft den normalen Reschedule-Pfad mit min_age=0 auf — durch existence-guard
-- auf job_queue + status='pending_enqueue' Filter ist der Aufruf idempotent:
-- Steps, die bereits geheilt wurden oder einen aktiven Job haben, werden geskippt.
CREATE OR REPLACE FUNCTION public.fn_replay_recent_reschedules(
  p_window_minutes integer DEFAULT 5,
  p_max_steps      integer DEFAULT 100
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _is_admin boolean;
  _result   record;
  _replay_marker text;
  _candidates_in_window integer;
BEGIN
  SELECT public.has_role(auth.uid(), 'admin'::app_role) INTO _is_admin;
  IF NOT COALESCE(_is_admin, false) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden: admin role required');
  END IF;

  _replay_marker := 'admin_replay_' || to_char(now(), 'YYYYMMDDHH24MISS');

  -- Wie viele pending_enqueue Steps gibt es aktuell, die im Window relevant sind?
  SELECT COUNT(*) INTO _candidates_in_window
  FROM public.package_steps
  WHERE status = 'pending_enqueue'
    AND updated_at > now() - make_interval(mins => p_window_minutes);

  -- Reschedule mit min_age=0 → alles eligible, idempotent durch Guards in der Funktion
  SELECT * INTO _result
  FROM public.fn_reschedule_pending_enqueue_steps(0, p_max_steps, _replay_marker);

  RETURN jsonb_build_object(
    'ok', true,
    'replay_marker', _replay_marker,
    'window_minutes', p_window_minutes,
    'candidates_in_window', _candidates_in_window,
    'rescheduled', _result.rescheduled_count,
    'skipped_active', _result.skipped_active,
    'skipped_not_building', _result.skipped_not_building,
    'ran_at', now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_replay_recent_reschedules(integer, integer) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.fn_replay_recent_reschedules(integer, integer) TO authenticated;

COMMENT ON FUNCTION public.fn_replay_recent_reschedules(integer, integer) IS
'Admin-Replay: ruft fn_reschedule_pending_enqueue_steps mit min_age=0 erneut auf — idempotent durch existing-job + status-guards.';
