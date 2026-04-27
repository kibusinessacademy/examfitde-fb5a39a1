-- =============================================================================
-- Recover/Heal Hotfixes — RPC-Reparaturen + Blocked-Status-Invariante
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) admin_quarantine_hotloop_jobs — RETURNING-Spalte aus FROM-CTE auflösen
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_quarantine_hotloop_jobs(
  p_attempt_threshold integer DEFAULT 10,
  p_dry_run boolean DEFAULT true,
  p_job_types text[] DEFAULT NULL::text[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_candidates jsonb;
  v_cancel_count int := 0;
  v_step_defer_count int := 0;
  v_by_type jsonb;
BEGIN
  IF v_uid IS NULL OR NOT public.is_admin(v_uid) THEN
    RAISE EXCEPTION 'unauthorized: admin required';
  END IF;

  WITH cand AS (
    SELECT id, job_type, package_id, status, attempts, max_attempts,
           left(coalesce(last_error,''), 200) AS last_error_trim,
           meta->>'step_key' AS step_key
    FROM public.job_queue
    WHERE status IN ('pending','queued','processing','running','batch_pending','failed')
      AND attempts >= p_attempt_threshold
      AND (p_job_types IS NULL OR job_type = ANY(p_job_types))
  )
  SELECT
    coalesce(jsonb_agg(jsonb_build_object(
      'job_id', id, 'job_type', job_type, 'package_id', package_id,
      'status', status, 'attempts', attempts, 'max_attempts', max_attempts,
      'last_error', last_error_trim, 'step_key', step_key
    ) ORDER BY attempts DESC), '[]'::jsonb),
    coalesce(jsonb_object_agg(job_type, cnt) FILTER (WHERE job_type IS NOT NULL), '{}'::jsonb)
  INTO v_candidates, v_by_type
  FROM (
    SELECT id, job_type, package_id, status, attempts, max_attempts, last_error_trim, step_key,
           count(*) OVER (PARTITION BY job_type) AS cnt
    FROM cand
  ) x;

  IF p_dry_run THEN
    INSERT INTO public.admin_actions(action, payload, user_id)
    VALUES ('admin_quarantine_hotloop_jobs:dry_run',
            jsonb_build_object('threshold',p_attempt_threshold,
                               'job_types',p_job_types,
                               'candidates',v_candidates,
                               'by_type',v_by_type),
            v_uid);

    RETURN jsonb_build_object(
      'ok', true, 'dry_run', true,
      'candidate_count', jsonb_array_length(v_candidates),
      'by_type', v_by_type,
      'candidates', v_candidates
    );
  END IF;

  PERFORM set_config('app.transition_source',
    'admin_ui:quarantine_hotloop:' || COALESCE(v_uid::text,'?'), true);

  -- Jobs cancellen — RETURNING NUR Spalten der target-Tabelle
  WITH cand AS (
    SELECT id
    FROM public.job_queue
    WHERE status IN ('pending','queued','processing','running','batch_pending','failed')
      AND attempts >= p_attempt_threshold
      AND (p_job_types IS NULL OR job_type = ANY(p_job_types))
  ),
  cancelled AS (
    UPDATE public.job_queue jq
    SET status='cancelled',
        completed_at = COALESCE(jq.completed_at, now()),
        locked_at = NULL,
        locked_by = NULL,
        last_error = COALESCE(jq.last_error,'') || ' | HOTLOOP_QUARANTINE_CANCELLED (attempts>=' || p_attempt_threshold || ')',
        updated_at = now()
    FROM cand c
    WHERE jq.id = c.id
    RETURNING jq.id, jq.package_id, jq.meta->>'step_key' AS step_key
  )
  SELECT count(*) INTO v_cancel_count FROM cancelled;

  -- Steps "skippen" über frische Scan auf cancelled-Jobs (Marker im last_error)
  WITH cand_steps AS (
    SELECT DISTINCT package_id, meta->>'step_key' AS step_key
    FROM public.job_queue jq
    WHERE jq.status='cancelled'
      AND jq.last_error LIKE '%HOTLOOP_QUARANTINE_CANCELLED%'
      AND jq.updated_at >= now() - interval '5 seconds'
      AND meta->>'step_key' IS NOT NULL
  ),
  upd_steps AS (
    UPDATE public.package_steps ps
    SET status='skipped'::step_status,
        last_error='HOTLOOP_QUARANTINE_AUTODEFER',
        meta = COALESCE(ps.meta,'{}'::jsonb) || jsonb_build_object(
                 'auto_deferred', true,
                 'defer_reason', 'HOTLOOP_QUARANTINE_AUTODEFER',
                 'auto_deferred_at', now(),
                 'auto_deferred_by', v_uid
               ),
        updated_at = now()
    FROM cand_steps c
    WHERE ps.package_id = c.package_id
      AND ps.step_key = c.step_key
      AND ps.status NOT IN ('done','skipped')
    RETURNING ps.id
  )
  SELECT count(*) INTO v_step_defer_count FROM upd_steps;

  INSERT INTO public.admin_actions(action, payload, user_id)
  VALUES ('admin_quarantine_hotloop_jobs:execute',
          jsonb_build_object('threshold',p_attempt_threshold,
                             'job_types',p_job_types,
                             'cancelled',v_cancel_count,
                             'steps_deferred',v_step_defer_count),
          v_uid);

  RETURN jsonb_build_object(
    'ok', true, 'dry_run', false,
    'cancelled', v_cancel_count,
    'steps_deferred', v_step_defer_count
  );
END;
$function$;

-- -----------------------------------------------------------------------------
-- 2) admin_reap_stale_processing_now — performed_by → user_id
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_reap_stale_processing_now(
  p_max_age_seconds integer DEFAULT 300,
  p_max_cancels integer DEFAULT 50
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_cutoff timestamptz := now() - make_interval(secs => p_max_age_seconds);
  v_requeued int := 0;
  v_failed   int := 0;
  v_jobs jsonb;
BEGIN
  IF v_uid IS NULL OR NOT public.is_admin(v_uid) THEN
    RAISE EXCEPTION 'unauthorized: admin required';
  END IF;

  PERFORM set_config('app.transition_source',
    'admin_ui:reap_stale_now:' || COALESCE(v_uid::text,'?'), true);

  WITH stale AS (
    SELECT id, job_type, package_id, attempts, max_attempts
    FROM public.job_queue
    WHERE status = 'processing'
      AND COALESCE(last_heartbeat_at, locked_at, started_at) < v_cutoff
    ORDER BY COALESCE(last_heartbeat_at, locked_at, started_at) ASC
    LIMIT GREATEST(p_max_cancels, 1)
  ),
  upd AS (
    UPDATE public.job_queue jq
    SET
      status = CASE
        WHEN jq.attempts >= jq.max_attempts THEN 'failed'
        ELSE 'pending'
      END,
      run_after = CASE
        WHEN jq.attempts >= jq.max_attempts THEN jq.run_after
        ELSE now() + interval '60 seconds'
      END,
      locked_at = NULL,
      locked_by = NULL,
      started_at = CASE
        WHEN jq.attempts >= jq.max_attempts THEN jq.started_at
        ELSE NULL
      END,
      last_error = CASE
        WHEN jq.attempts >= jq.max_attempts
          THEN COALESCE(jq.last_error,'') || ' | STALE_PROCESSING_EXHAUSTED (admin_reap_now)'
        ELSE COALESCE(jq.last_error,'') || ' | STALE_PROCESSING_REAPED (admin_reap_now)'
      END,
      updated_at = now()
    FROM stale s
    WHERE jq.id = s.id
    RETURNING jq.id, jq.job_type, jq.status, jq.package_id, jq.attempts
  )
  SELECT
    coalesce(sum(case when status='pending' then 1 else 0 end),0),
    coalesce(sum(case when status='failed'  then 1 else 0 end),0),
    coalesce(jsonb_agg(jsonb_build_object(
      'job_id',id,'job_type',job_type,'package_id',package_id,
      'attempts',attempts,'new_status',status
    )), '[]'::jsonb)
  INTO v_requeued, v_failed, v_jobs
  FROM upd;

  -- FIX: performed_by existiert nicht — admin_actions verwendet user_id
  INSERT INTO public.admin_actions(action, payload, user_id)
  VALUES ('admin_reap_stale_processing_now',
          jsonb_build_object('cutoff_seconds',p_max_age_seconds,
                             'max_cancels',p_max_cancels,
                             'requeued',v_requeued,
                             'failed_terminal',v_failed,
                             'jobs',v_jobs),
          v_uid);

  RETURN jsonb_build_object(
    'ok', true,
    'requeued', v_requeued,
    'failed_terminal', v_failed,
    'cutoff_seconds', p_max_age_seconds
  );
END;
$function$;

-- -----------------------------------------------------------------------------
-- 3) Invariante: status='blocked' ⇔ blocked_reason gesetzt
--    Heilt also implizit: clearing blocked_reason ohne status-Wechsel = Verstoß
--    (existing trg_guard_blocked_requires_reason prüft blocked→reason; wir härten
--     das umgekehrte: reason gesetzt ⇒ status MUSS 'blocked' sein, sonst auto-clear)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_assert_blocked_status_reason_consistency()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  -- Wenn status NICHT 'blocked' ist, MUSS blocked_reason NULL sein.
  -- Heal-Pfade dürfen blocked_reason explizit clearen → wir clearen
  -- konsistent mit, statt zu raisen (idempotent für Heal-Aktionen).
  IF NEW.status IS DISTINCT FROM 'blocked' AND NEW.blocked_reason IS NOT NULL THEN
    NEW.blocked_reason := NULL;
    NEW.blocked_at := NULL;
    NEW.blocked_by := NULL;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_assert_blocked_status_reason_consistency ON public.course_packages;
CREATE TRIGGER trg_assert_blocked_status_reason_consistency
  BEFORE INSERT OR UPDATE ON public.course_packages
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_assert_blocked_status_reason_consistency();

-- Audit any sub-trigger that re-blocks a healed package
CREATE OR REPLACE FUNCTION public.fn_audit_reblock_after_heal()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF OLD.status IS DISTINCT FROM 'blocked' AND NEW.status = 'blocked' THEN
    INSERT INTO public.auto_heal_log
      (action_type, target_type, target_id, trigger_source, result_status, result_detail)
    VALUES
      ('REBLOCK_AFTER_HEAL_OBSERVED', 'package', NEW.id::text,
       COALESCE(current_setting('app.transition_source', true), 'unknown'),
       'warning',
       format('package re-blocked from status=%s reason=%s', OLD.status, COALESCE(NEW.blocked_reason,'?')));
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_audit_reblock_after_heal ON public.course_packages;
CREATE TRIGGER trg_audit_reblock_after_heal
  AFTER UPDATE ON public.course_packages
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.fn_audit_reblock_after_heal();
