-- Hotfix: admin_quarantine_hotloop_jobs
--   1) step_status hat kein 'deferred' -> nutze 'skipped' + meta-Marker
--   2) admin_actions Spalte heißt user_id (nicht performed_by)

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

  -- Jobs cancellen
  WITH cand AS (
    SELECT id, package_id, meta->>'step_key' AS step_key
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
    RETURNING jq.id, jq.package_id, c.step_key
  )
  SELECT count(*) INTO v_cancel_count FROM cancelled;

  -- Steps "skippen" (deferred existiert nicht im step_status enum) +
  -- Defer-Info strukturiert in meta hinterlegen, damit Re-Enable möglich ist.
  WITH cand_steps AS (
    SELECT DISTINCT package_id, step_key
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
    RETURNING ps.package_id, ps.step_key
  )
  SELECT count(*) INTO v_step_defer_count FROM upd_steps;

  INSERT INTO public.admin_actions(action, payload, user_id)
  VALUES ('admin_quarantine_hotloop_jobs:execute',
          jsonb_build_object('threshold',p_attempt_threshold,
                             'job_types',p_job_types,
                             'cancelled',v_cancel_count,
                             'steps_deferred',v_step_defer_count,
                             'by_type',v_by_type,
                             'candidates',v_candidates),
          v_uid);

  RETURN jsonb_build_object(
    'ok', true, 'dry_run', false,
    'cancelled', v_cancel_count,
    'steps_deferred', v_step_defer_count,
    'by_type', v_by_type
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.admin_quarantine_hotloop_jobs(integer, boolean, text[]) TO authenticated;